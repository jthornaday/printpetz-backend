/**
 * Shopify `orders/paid` -> Printful.
 *
 * HMAC is verified before anything else happens. An unverified webhook is an open
 * door to making us print and ship things for free.
 *
 * Needs the raw request body. app.ts captures `req.rawbody` for /webhook/stripe;
 * that capture must be extended to /webhook/shopify or verification cannot work.
 */
import crypto from "node:crypto";

import { Request, Response } from "express";

import { Treatment } from "@/constants/print_products";
import { printfulVariantForShopify } from "@/constants/printful_variants";
import AppConstants from "@/constants/app_constants";
import {
  createFulfillmentOrder, FulfillmentItem, FulfillmentRequest, PrintfulRecipient,
} from "@/services/printful_service";
import { addErrorLog } from "@/services/error_logs_service";

type RawBodyRequest = Request & { rawbody?: string };

/**
 * An order we can never fulfil, however many times Shopify retries it — no PrintPetz
 * items, no address, a half-specified line. These must answer 200: Shopify retries a
 * failing webhook 8 times over ~4 hours and then DELETES the subscription, after which
 * every order silently stops reaching Printful. One stray order must not do that.
 */
export class UnfulfillableOrderError extends Error {}

/** Timing-safe HMAC check against SHOPIFY_WEBHOOK_SECRET. */
export const verifyShopifyHmac = (rawBody: string, header: string | undefined): boolean => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !header || !rawBody) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * The cart is built in the customer's browser, so `_generation_url` is whatever they
 * sent. Only print images that live in our own generations folder on our CDN —
 * otherwise anyone could pay to have any picture printed under the PrintPetz name.
 */
const GENERATIONS_ORIGIN = new URL(AppConstants.cloudfrontDomain).origin;
export const isOurGenerationUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.origin === GENERATIONS_ORIGIN && u.pathname.startsWith("/generations/");
  } catch {
    return false;
  }
};

const propOf = (li: any, name: string): string | undefined =>
  (li?.properties ?? []).find((p: any) => p?.name === name || p?.name === `_${name}`)?.value;

/**
 * Map a Shopify order onto a fulfilment request.
 *
 * The three things we need per line item — which generation, which product, which
 * treatment — ride on the line item as properties. M2 puts them there.
 */
export const fulfillmentFromShopifyOrder = (order: any): FulfillmentRequest => {
  const a = order?.shipping_address ?? order?.billing_address;
  if (!a) throw new UnfulfillableOrderError("order has no shipping or billing address");

  const recipient: PrintfulRecipient = {
    name: a.name ?? `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim(),
    address1: a.address1,
    address2: a.address2 ?? undefined,
    city: a.city,
    state_code: a.province_code ?? undefined,
    country_code: a.country_code,
    zip: a.zip,
    email: order.email ?? undefined,
  };

  const lineItems: any[] = order?.line_items ?? [];
  const items: FulfillmentItem[] = [];

  for (const [i, li] of lineItems.entries()) {
    const sourceImageUrl = propOf(li, "generation_url");
    const productKey = propOf(li, "product_key");
    // A line item with no PrintPetz properties is not ours — a gift card, a credit
    // pack. Skip it rather than failing the whole order.
    if (!sourceImageUrl && !productKey) continue;
    if (!sourceImageUrl) throw new UnfulfillableOrderError(`line item ${i} has product_key but no generation_url`);
    if (!productKey) throw new UnfulfillableOrderError(`line item ${i} has generation_url but no product_key`);
    if (!isOurGenerationUrl(sourceImageUrl)) {
      throw new UnfulfillableOrderError(`line item ${i} generation_url is not a PrintPetz generation: ${sourceImageUrl}`);
    }
    // The size the customer PAID for is the Shopify variant, not our product key.
    const mapped = printfulVariantForShopify(li.variant_id);
    if (!mapped) {
      console.warn(
        "[shopify-webhook] unmapped Shopify variant, using product default",
        JSON.stringify({ shopifyOrderId: order?.id, variantId: li.variant_id, productKey }),
      );
    }
    items.push({
      sourceImageUrl,
      productKey,
      treatment: (propOf(li, "treatment") ?? "panel") as Treatment,
      quantity: li.quantity ?? 1,
      generationId: propOf(li, "generation_id"),
      printfulVariantId: mapped?.printfulVariantId,
    });
  }

  if (!items.length) throw new UnfulfillableOrderError("order contains no PrintPetz line items");
  // Shopify marks test-mode orders `test: true`. They prove the pipeline but must never
  // print, even once PRINTFUL_AUTO_CONFIRM is on.
  return { externalId: String(order.id), recipient, items, forceDraft: order?.test === true };
};

export const shopifyOrderPaid = async (req: RawBodyRequest, res: Response) => {
  const raw = req.rawbody ?? "";
  const header = req.get("X-Shopify-Hmac-Sha256");

  if (!verifyShopifyHmac(raw, header)) {
    // Do not leak why. Do not process.
    return res.status(401).json({ error: "invalid signature" });
  }

  let order: any;
  try {
    order = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "malformed body" });
  }

  let request: FulfillmentRequest;
  try {
    request = fulfillmentFromShopifyOrder(order);
  } catch (error) {
    // Validation failed. Retrying can never fix it, so answer 200 and make it loud.
    // If this fires, a customer may have paid and received nothing — someone must look.
    const message = (error as Error).message;
    console.error(
      "[shopify-webhook] UNFULFILLABLE order acknowledged, not processed",
      JSON.stringify({ shopifyOrderId: order?.id, reason: message }),
    );
    addErrorLog({
      input: JSON.stringify({ shopifyOrderId: order?.id, orderName: order?.name }),
      error: JSON.stringify({ message }),
      type: "SHOPIFY_ORDER_UNFULFILLABLE",
    });
    return res.status(200).json({ ok: false, ignored: true, reason: message });
  }

  // Answer Shopify now. It waits 5 seconds, and building a print file (cutout calls
  // background removal, 4-18s) plus S3 plus Printful routinely takes longer. Work
  // continues below; the Printful external_id lookup keeps any retry from duplicating.
  res.status(200).json({ ok: true, accepted: true, shopifyOrderId: order.id, test: request.forceDraft });

  void processFulfillment(request, order);
};

/**
 * Runs after the response. Shopify will NOT retry a failure here, so failures are
 * logged with everything needed to replay the order by hand
 * (`npm run replay-order -- --file=<order.json>`).
 */
const processFulfillment = async (request: FulfillmentRequest, order: any) => {
  try {
    const result = await createFulfillmentOrder(request);
    if (!result.created) {
      console.log(
        "[shopify-webhook] duplicate suppressed",
        JSON.stringify({ shopifyOrderId: order.id, printfulOrderId: result.orderId }),
      );
      return;
    }
    console.log(
      "[shopify-webhook] fulfilled",
      JSON.stringify({
        shopifyOrderId: order.id,
        printfulOrderId: result.orderId,
        status: result.status,
        confirmed: result.confirmed,
        test: request.forceDraft,
      }),
    );
  } catch (error) {
    console.error(
      "[shopify-webhook] FULFILMENT FAILED after acknowledging Shopify",
      JSON.stringify({ shopifyOrderId: order?.id, message: (error as Error).message }),
    );
    addErrorLog({
      // The full request, so the order can be replayed without the Shopify admin.
      input: JSON.stringify({ shopifyOrderId: order?.id, request }),
      error: JSON.stringify({ message: (error as Error).message }),
      type: "SHOPIFY_FULFILLMENT_FAILED",
    });
  }
};
