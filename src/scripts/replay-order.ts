/**
 * Replay a Shopify order into Printful.
 *
 * This is how M3 is tested without a storefront: hand it a saved Shopify order
 * payload (or use --demo) and it runs the real path — build print file, upload to
 * S3, create the Printful order, poll until Printful validates the file.
 *
 *   npm run replay-order -- --demo --pet=Wizard --product=mug_11oz
 *   npm run replay-order -- --file=path/to/shopify-order.json
 *   npm run replay-order -- --demo --product=poster_8x10 --cancel
 *
 * Orders are DRAFTS unless PRINTFUL_AUTO_CONFIRM=true. A draft never prints.
 */
import "module-alias/register";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import fs from "node:fs";
import path from "node:path";

import { Treatment } from "@/constants/print_products";
import { uploadFileToS3 } from "@/services/aws_service";
import {
  createFulfillmentOrder, waitForFileValidation, cancelOrder,
  FulfillmentItem, FulfillmentRequest, PrintfulRecipient,
} from "@/services/printful_service";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Shopify puts custom data on line items as name/value properties. */
const propOf = (li: any, name: string): string | undefined =>
  (li.properties ?? []).find((p: any) => p.name === name || p.name === `_${name}`)?.value;

const fromShopifyOrder = (order: any): FulfillmentRequest => {
  const a = order.shipping_address ?? order.billing_address;
  if (!a) throw new Error("order has no shipping_address or billing_address");

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

  const items: FulfillmentItem[] = (order.line_items ?? []).map((li: any, i: number) => {
    const sourceImageUrl = propOf(li, "generation_url");
    const productKey = propOf(li, "product_key");
    const treatment = (propOf(li, "treatment") ?? "panel") as Treatment;
    if (!sourceImageUrl) throw new Error(`line item ${i} has no generation_url property`);
    if (!productKey) throw new Error(`line item ${i} has no product_key property`);
    return {
      sourceImageUrl, productKey, treatment,
      quantity: li.quantity ?? 1,
      generationId: propOf(li, "generation_id"),
    };
  });

  if (!items.length) throw new Error("order has no line items");
  return { externalId: String(order.id), recipient, items };
};

/** Publish a local pet image to S3 so the real fetch path is exercised. */
const demoSourceUrl = async (pet: string) => {
  const local = path.join(process.cwd(), "Claude outputs", "upscale-eval", pet, "original.jpg");
  if (!fs.existsSync(local)) throw new Error(`no local image for ${pet} at ${local}`);
  const url = await uploadFileToS3({
    Key: `print-files/_demo/${pet}-source.jpg`,
    buffer: fs.readFileSync(local),
    fileType: "image/jpeg",
  });
  if (!url) throw new Error("demo source upload failed");
  return url;
};

const demoOrder = async (): Promise<FulfillmentRequest> => {
  const pet = arg("pet") ?? "Wizard";
  const productKey = arg("product") ?? "mug_11oz";
  const treatment = (arg("treatment") ?? "panel") as Treatment;
  return {
    // Printful rejects non-numeric external ids on a Shopify-platform store
    // ("Invalid External ID specified"). Real Shopify order ids are numeric, so
    // production is unaffected — but the demo must look like one.
    externalId: arg("external-id") ?? String(Date.now()),
    recipient: {
      name: "API Draft Test",
      address1: "19749 Dearborn St",
      city: "Chatsworth", state_code: "CA", country_code: "US", zip: "91311",
    },
    items: [{
      sourceImageUrl: await demoSourceUrl(pet),
      productKey, treatment, quantity: 1,
      generationId: `demo-${pet}`,
    }],
  };
};

const main = async () => {
  const file = arg("file");
  if (!file && !flag("demo")) {
    console.error("usage: --file=<shopify-order.json> | --demo [--pet=Wizard] [--product=mug_11oz] [--treatment=panel]");
    console.error("       add --cancel to discard the order after verifying it");
    process.exit(1);
  }

  const req = file
    ? fromShopifyOrder(JSON.parse(fs.readFileSync(file, "utf8")))
    : await demoOrder();

  console.log(`\nexternal id : ${req.externalId}`);
  console.log(`recipient   : ${req.recipient.name}, ${req.recipient.city} ${req.recipient.state_code ?? ""} ${req.recipient.country_code}`);
  for (const it of req.items) {
    console.log(`item        : ${it.productKey} [${it.treatment}] x${it.quantity}  gen=${it.generationId ?? "-"}`);
  }
  console.log(`mode        : ${process.env.PRINTFUL_AUTO_CONFIRM === "true" ? "CONFIRM (will print!)" : "draft (safe)"}\n`);

  const result = await createFulfillmentOrder(req);
  if (!result.created) {
    console.log(`SKIPPED — ${result.reason}. Existing Printful order ${result.orderId} (${result.status}).`);
    console.log("Idempotency held: no duplicate created.\n");
    return;
  }

  console.log(`CREATED Printful order ${result.orderId}  status=${result.status}`);
  if (result.costs) console.log(`costs: ${JSON.stringify(result.costs)}`);

  console.log("\nwaiting for Printful to fetch and validate the print file...");
  const files = await waitForFileValidation(result.orderId);
  if (!files) {
    console.log("  TIMED OUT — file still not validated. Check the order in Printful.");
  } else {
    for (const f of files) {
      console.log(`  file status=${f.status} dpi=${f.dpi ?? "-"} size=${f.width ?? "-"}x${f.height ?? "-"} preview=${Boolean(f.preview_url)}`);
    }
  }

  if (flag("cancel")) {
    const c = await cancelOrder(result.orderId);
    console.log(`\ncancelled: ok=${c.ok} status=${c.status}`);
  } else {
    console.log(`\nOrder ${result.orderId} left in Printful as ${result.status}. Add --cancel to discard it.`);
  }
  console.log();
};

main().catch((e) => { console.error("\nFAILED:", e.message ?? e); process.exit(1); });
