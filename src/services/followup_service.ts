/**
 * The post-delivery check-in: "How did [Max]'s mug turn out?", 8 days after the order shipped
 * (specs/merch-reviews-followup.md §1, §5 #2, §6.3). It asks for a reply, not a review: unhappy
 * customers reach support (reprint or full refund) before Judge.me's review request, which goes
 * to EVERY customer about 20 days after payment, so this is not review gating.
 *
 * Never sent to test orders, cancelled orders, orders that haven't shipped, or addresses that
 * replied "stop" (email_suppressions). Claimed in the database before sending, so several servers
 * can't both send it. Sent only 14:00–23:00 UTC (10am–7pm US Eastern).
 */
import supabase from "@/supabase/create_client";

import { sendEmail } from "./email_service";
import { addErrorLog } from "./error_logs_service";
import { getGenerationById } from "./generation_service";
import { getPetNameForPrint } from "./model_service";
import { FulfillmentRequest, printfulFetch } from "./printful_service";

const TABLE = "merch_orders";
const SUPPORT_EMAIL = "myprintpetz@gmail.com";
const DAYS_AFTER_SHIPPING = 8;
/** Past this many days since payment the check-in would land after Judge.me's day-20 request. */
const TOO_LATE_DAYS = 17;
const SEND_HOURS_UTC = { from: 14, to: 23 };

/** How the customer would name each product in a sentence. */
const PRODUCT_NOUNS: Record<string, string> = {
  poster_8x10: "8×10 print",
  framed_8x10: "framed print",
  canvas_16x20: "canvas",
  mug_11oz: "mug",
  coaster_4x4: "coaster",
  can_cooler: "can cooler",
  pillow_18x18: "pillow",
  ornament_ceramic_circle: "ornament",
  ornament_metal_oval: "ornament",
  card_4x6: "greeting cards",
  pet_bowl: "pet bowl",
  pint_glass_16oz: "pint glass",
};

const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** "Max" -> "Max's", "Moses" -> "Moses'". */
const possessive = (name: string) =>
  /s$/i.test(name) ? `${name}'` : `${name}'s`;

export type CheckInDetails = {
  orderName: string;
  firstName: string | null;
  petName: string | null;
  productNoun: string;
  moreItems: number;
  imageUrl: string | null;
  trackingUrl: string | null;
  postalAddress: string | null;
};

/** The check-in email (§5 #2). No rating buttons and no review link, on purpose. */
export const checkInEmail = (d: CheckInDetails) => {
  const pet = d.petName ?? "your pet";
  const what = `${d.productNoun}${d.moreItems ? ` (and ${d.moreItems} more item${d.moreItems === 1 ? "" : "s"})` : ""}`;
  const subject = d.petName
    ? `How did ${possessive(d.petName)} ${d.productNoun} turn out?`
    : `How did your ${d.productNoun} turn out?`;
  const hello = d.firstName ? `Hi ${d.firstName},` : "Hi,";
  const footer = `${d.postalAddress ? `${d.postalAddress} · ` : ""}Reply "stop" and we won't send more follow-up emails.`;
  const text = [
    hello,
    "",
    `Your order ${d.orderName}, the ${what} with ${pet} on it, should be with you by now.`,
    "",
    "How did it turn out? Hit reply and tell us. Jake, the owner, reads every reply.",
    "",
    "If it arrived damaged, misprinted, or not what you ordered, reply with a photo within 30 days. We'll reprint it free or refund you in full, your choice.",
    "",
    d.trackingUrl ? `Not there yet? Track your package: ${d.trackingUrl}` : "",
    "",
    "PrintPetz",
    "",
    footer,
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");
  const html = `<div style="font:15px/1.6 Arial,sans-serif;color:#141820;max-width:560px">
<span style="display:none">One question from PrintPetz.</span>
<p>${escapeHtml(hello)}</p>
<p>Your order <strong>${escapeHtml(d.orderName)}</strong>, the ${escapeHtml(what)} with ${escapeHtml(pet)} on it, should be with you by now.</p>
${d.imageUrl ? `<p><img src="${escapeHtml(d.imageUrl)}" alt="${escapeHtml(pet)}" width="240" style="border-radius:6px;max-width:100%"></p>` : ""}
<p><strong>How did it turn out?</strong> Hit reply and tell us. Jake, the owner, reads every reply.</p>
<p>If it arrived damaged, misprinted, or not what you ordered, reply with a photo within 30 days. We'll reprint it free or refund you in full, your choice.</p>
${d.trackingUrl ? `<p>Not there yet? <a href="${escapeHtml(d.trackingUrl)}" style="color:#2454df">Track your package</a></p>` : ""}
<p>PrintPetz</p>
<p style="color:#606671;font-size:12px">${escapeHtml(footer)}</p>
</div>`;
  return { subject, text, html };
};

type DueOrder = {
  shopify_order_id: string;
  order_name: string | null;
  printful_order_id: number | null;
  request: FulfillmentRequest | null;
  shipped_at: string;
  received_at: string;
};

const isSuppressed = async (email: string) => {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("email")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) {
    throw new Error(`email_suppressions lookup failed: ${error.message}`);
  }
  return Boolean(data);
};

/** Add an address to the "no more follow-ups" list (npm run suppress-email). */
export const suppressEmail = async (email: string, source: string) => {
  const { error } = await supabase
    .from("email_suppressions")
    .upsert(
      { email: email.trim().toLowerCase(), source },
      { onConflict: "email" },
    );
  if (error) {
    throw new Error(`email_suppressions insert failed: ${error.message}`);
  }
};

const detailsFor = async (row: DueOrder): Promise<CheckInDetails> => {
  const items = row.request?.items ?? [];
  const first = items[0];
  let petName: string | null = null;
  if (first?.generationId) {
    const generation = await getGenerationById(
      Number(first.generationId),
    ).catch(() => null);
    if (generation) {
      petName =
        (
          await getPetNameForPrint(generation.model_id).catch(() => null)
        )?.trim() || null;
    }
  }
  let trackingUrl: string | null = null;
  if (row.printful_order_id) {
    const { status, json } = await printfulFetch(
      `/orders/${row.printful_order_id}`,
    ).catch(() => ({ status: 0, json: {} }));
    if (status === 200) {
      const shipments =
        (json as { result?: { shipments?: Array<{ tracking_url?: string }> } })
          .result?.shipments ?? [];
      trackingUrl = shipments.find((s) => s.tracking_url)?.tracking_url ?? null;
    }
  }
  return {
    orderName: row.order_name ?? `#${row.shopify_order_id}`,
    firstName: row.request?.recipient?.name?.trim().split(/\s+/)[0] || null,
    petName,
    productNoun: PRODUCT_NOUNS[first?.productKey ?? ""] ?? "order",
    moreItems: Math.max(0, items.length - 1),
    imageUrl: first?.sourceImageUrl ?? null,
    trackingUrl,
    postalAddress: process.env.PRINTPETZ_POSTAL_ADDRESS?.trim() || null,
  };
};

/** Claim one order's check-in for this server. False if another server (or an earlier run) has it. */
const claim = async (id: string, fields: Record<string, unknown>) => {
  const { data, error } = await supabase
    .from(TABLE)
    .update(fields)
    .eq("shopify_order_id", id)
    .is("checkin_sent_at", null)
    .select("shopify_order_id");
  if (error) {
    throw new Error(`check-in claim failed for ${id}: ${error.message}`);
  }
  return (data ?? []).length > 0;
};

/** One pass: send every check-in that's due. Returns how many went out. */
export const sendCheckIns = async (now = new Date()) => {
  const hour = now.getUTCHours();
  if (hour < SEND_HOURS_UTC.from || hour >= SEND_HOURS_UTC.to) {
    return 0;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "shopify_order_id, order_name, printful_order_id, request, shipped_at, received_at",
    )
    .eq("status", "fulfilled")
    .eq("test", false)
    .is("cancelled_at", null)
    .is("checkin_sent_at", null)
    .not("shipped_at", "is", null)
    .lte(
      "shipped_at",
      new Date(now.getTime() - DAYS_AFTER_SHIPPING * 86_400_000).toISOString(),
    )
    .limit(25);
  if (error) {
    throw new Error(`check-in query failed: ${error.message}`);
  }
  let sent = 0;
  for (const row of (data ?? []) as DueOrder[]) {
    try {
      const to = row.request?.recipient?.email?.trim();
      const tooLate =
        new Date(row.received_at).getTime() <
        now.getTime() - TOO_LATE_DAYS * 86_400_000;
      if (!to || tooLate || (await isSuppressed(to))) {
        // Recorded as skipped so it isn't looked at again.
        await claim(row.shopify_order_id, {
          checkin_sent_at: now.toISOString(),
          checkin_skipped: true,
        });
        continue;
      }
      if (
        !(await claim(row.shopify_order_id, {
          checkin_sent_at: now.toISOString(),
        }))
      ) {
        continue;
      }
      const ok = await sendEmail({
        to,
        ...checkInEmail(await detailsFor(row)),
        replyTo: SUPPORT_EMAIL,
        idempotencyKey: `checkin-${row.shopify_order_id}`,
        tags: [{ name: "category", value: "order_checkin" }],
      });
      if (ok) {
        sent++;
      }
    } catch (err) {
      addErrorLog({
        input: JSON.stringify({ shopifyOrderId: row.shopify_order_id }),
        error: JSON.stringify({ message: (err as Error).message }),
        type: "ORDER_CHECKIN",
      });
    }
  }
  return sent;
};
