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
import {
  createFulfillmentOrder, FulfillmentItem, FulfillmentRequest, PrintfulRecipient,
} from "@/services/printful_service";
import { addErrorLog } from "@/services/error_logs_service";

type RawBodyRequest = Request & { rawbody?: string };

/** Timing-safe HMAC check against SHOPIFY_WEBHOOK_SECRET. */
export const verifyShopifyHmac = (rawBody: string, header: string | undefined): boolean => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !header || !rawBody) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  if (!a) throw new Error("order has no shipping or billing address");

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
    if (!sourceImageUrl) throw new Error(`line item ${i} has product_key but no generation_url`);
    if (!productKey) throw new Error(`line item ${i} has generation_url but no product_key`);
    items.push({
      sourceImageUrl,
      productKey,
      treatment: (propOf(li, "treatment") ?? "panel") as Treatment,
      quantity: li.quantity ?? 1,
      generationId: propOf(li, "generation_id"),
    });
  }

  if (!items.length) throw new Error("order contains no PrintPetz line items");
  return { externalId: String(order.id), recipient, items };
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

  try {
    const request = fulfillmentFromShopifyOrder(order);
    const result = await createFulfillmentOrder(request);

    if (!result.created) {
      console.log(
        "[shopify-webhook] duplicate suppressed",
        JSON.stringify({ shopifyOrderId: order.id, printfulOrderId: result.orderId }),
      );
      return res.status(200).json({ ok: true, duplicate: true, printfulOrderId: result.orderId });
    }

    return res.status(200).json({
      ok: true,
      printfulOrderId: result.orderId,
      status: result.status,
      confirmed: result.confirmed,
    });
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ shopifyOrderId: order?.id }),
      error: JSON.stringify({ message: (error as Error).message }),
      type: "SHOPIFY_ORDER_PAID",
    });
    // 500 so Shopify retries. Our idempotency guard makes a retry safe.
    return res.status(500).json({ error: (error as Error).message });
  }
};
