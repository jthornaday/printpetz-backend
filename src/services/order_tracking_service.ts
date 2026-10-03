/**
 * After a paid order reaches Printful (launch checklist B1 + B2):
 *
 * - Tracking: every 15 minutes, look up Printful orders that haven't finished shipping and email
 *   the customer once per package ("Your PrintPetz order is on its way", carrier, tracking link).
 *   Shopify isn't told (we have no Admin API token), so Shopify keeps showing "Unfulfilled".
 * - Cancellation (Shopify orders/cancelled): stop the print if Printful hasn't started it, and tell
 *   Jake either way. An order cancelled before it reached Printful is never sent.
 * - Refund (Shopify refunds/create): no automatic action, since a refund can be partial or a
 *   goodwill gesture after delivery. Jake gets an email saying where the print stands.
 *
 * Shopify test orders never email customers.
 */
import { supportEmail } from "@/constants/support";
import supabase from "@/supabase/create_client";

import { sendAlert } from "./alert_service";
import { sendEmail } from "./email_service";
import { addErrorLog } from "./error_logs_service";
import { sendCheckIns } from "./followup_service";
import {
  cancelOrder,
  FulfillmentRequest,
  printfulFetch,
} from "./printful_service";

const TABLE = "merch_orders";
const EVERY_MS = 15 * 60_000;
/** Keep watching an order for further packages for this long after its first shipment. */
const FOLLOW_SHIPPED_DAYS = 10;
/** Stop looking for a first shipment after this long (Printful normally ships in 2–5 days). */
const GIVE_UP_DAYS = 45;
/** Printful statuses in which an order can still be cancelled without charge. */
const CANCELLABLE = new Set(["draft", "pending", "failed", "onhold"]);

type Shipment = {
  id: number;
  carrier?: string;
  service?: string;
  tracking_number?: string;
  tracking_url?: string;
  ship_date?: string;
};

type TrackedOrder = {
  shopify_order_id: string;
  order_name: string | null;
  printful_order_id: number;
  request: FulfillmentRequest | null;
  shipments_emailed: number[] | null;
  shipped_at: string | null;
};

const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The "on its way" email for one package. */
export const shippedEmail = (
  orderName: string,
  firstName: string | null,
  s: Shipment,
) => {
  const hello = firstName ? `Hi ${firstName},` : "Hi,";
  const carrier = [s.carrier, s.service].filter(Boolean).join(" ");
  const lines = [
    hello,
    "",
    `Good news: your PrintPetz order ${orderName} is on its way.`,
    "",
    carrier ? `Carrier: ${carrier}` : "",
    s.tracking_number ? `Tracking number: ${s.tracking_number}` : "",
    s.tracking_url ? `Track it: ${s.tracking_url}` : "",
    "",
    "It usually arrives within 3–4 business days.",
    "",
    "If anything arrives damaged or wrong, reply with a photo within 30 days and we'll reprint it free or refund you in full.",
    "",
    "Thanks for ordering,",
    "PrintPetz",
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "");
  const link = s.tracking_url
    ? `<p style="margin:24px 0"><a href="${escapeHtml(s.tracking_url)}" style="background:#2454df;color:#fff;padding:12px 20px;border-radius:7px;text-decoration:none;font-weight:700">Track your package</a></p>`
    : "";
  const html = `<div style="font:15px/1.6 Arial,sans-serif;color:#141820;max-width:560px">
<p style="font-size:22px;font-weight:700;margin:0 0 16px">Your order is on its way</p>
<p>${escapeHtml(hello)}</p>
<p>Good news: your PrintPetz order <strong>${escapeHtml(orderName)}</strong> has shipped.</p>
${carrier ? `<p style="margin:0">Carrier: ${escapeHtml(carrier)}</p>` : ""}
${s.tracking_number ? `<p style="margin:0">Tracking number: ${escapeHtml(s.tracking_number)}</p>` : ""}
${link}
<p>It usually arrives within 3–4 business days.</p>
<p style="color:#4d5561;font-size:13px">If anything arrives damaged or wrong, reply with a photo within 30 days and we'll reprint it free or refund you in full.</p>
<p>Thanks for ordering,<br>PrintPetz</p>
</div>`;
  return {
    subject: `Your PrintPetz order ${orderName} is on its way`,
    text: lines.join("\n"),
    html,
  };
};

/** Email the customer about any new packages on one order. Returns how many emails went out. */
const notifyShipments = async (row: TrackedOrder) => {
  const { status, json } = await printfulFetch(
    `/orders/${row.printful_order_id}`,
  );
  if (status !== 200) {
    throw new Error(
      `Printful order ${row.printful_order_id} lookup returned ${status}`,
    );
  }
  const shipments = (
    (json as { result?: { shipments?: Shipment[] } }).result?.shipments ?? []
  ).filter((s) => s.id);
  const done = new Set(row.shipments_emailed ?? []);
  const fresh = shipments.filter((s) => !done.has(s.id));
  if (!fresh.length) {
    return 0;
  }
  const to = row.request?.recipient?.email;
  const orderName = row.order_name ?? `#${row.shopify_order_id}`;
  const firstName =
    row.request?.recipient?.name?.trim().split(/\s+/)[0] ?? null;
  let sent = 0;
  for (const s of fresh) {
    if (to) {
      const mail = shippedEmail(orderName, firstName, s);
      const ok = await sendEmail({
        to,
        ...mail,
        replyTo: supportEmail(),
        idempotencyKey: `shipped-${row.printful_order_id}-${s.id}`,
        tags: [{ name: "category", value: "order_shipped" }],
      });
      if (!ok) {
        continue; // not recorded, so the next run tries again
      }
      sent++;
    } else {
      addErrorLog({
        input: JSON.stringify({
          shopifyOrderId: row.shopify_order_id,
          shipmentId: s.id,
        }),
        error: JSON.stringify({ message: "no customer email on the order" }),
        type: "SHIPPED_EMAIL_NO_ADDRESS",
      });
    }
    done.add(s.id);
  }
  const firstShipDate = shipments
    .map((s) => s.ship_date)
    .filter(Boolean)
    .sort()[0];
  await supabase
    .from(TABLE)
    .update({
      shipments_emailed: [...done],
      shipped_at:
        row.shipped_at ??
        (firstShipDate
          ? new Date(firstShipDate).toISOString()
          : new Date().toISOString()),
    })
    .eq("shopify_order_id", row.shopify_order_id);
  return sent;
};

/** One pass over orders that may have new packages. */
export const checkShipments = async () => {
  const now = Date.now();
  const recentShip = new Date(
    now - FOLLOW_SHIPPED_DAYS * 86_400_000,
  ).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "shopify_order_id, order_name, printful_order_id, request, shipments_emailed, shipped_at",
    )
    .eq("status", "fulfilled")
    .eq("test", false)
    .not("printful_order_id", "is", null)
    .gt("received_at", new Date(now - GIVE_UP_DAYS * 86_400_000).toISOString())
    .or(`shipped_at.is.null,shipped_at.gt.${recentShip}`)
    .limit(50);
  if (error) {
    throw new Error(`merch_orders shipment query failed: ${error.message}`);
  }
  let sent = 0;
  for (const row of (data ?? []) as TrackedOrder[]) {
    try {
      sent += await notifyShipments(row);
    } catch (err) {
      addErrorLog({
        input: JSON.stringify({ shopifyOrderId: row.shopify_order_id }),
        error: JSON.stringify({ message: (err as Error).message }),
        type: "SHIPMENT_CHECK",
      });
    }
  }
  return sent;
};

const printfulStatus = async (printfulOrderId: number) => {
  const { status, json } = await printfulFetch(`/orders/${printfulOrderId}`);
  return status === 200
    ? (json as { result?: { status?: string } }).result?.status ?? null
    : null;
};

/** Shopify cancelled an order: stop the print if we still can, and tell Jake what happened. */
export const handleOrderCancelled = async (order: {
  id: unknown;
  name?: string;
  test?: boolean;
}) => {
  const id = String(order.id);
  const name = order.name ?? `#${id}`;
  const { data, error } = await supabase
    .from(TABLE)
    .select("status, printful_order_id")
    .eq("shopify_order_id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`merch_orders lookup failed: ${error.message}`);
  }
  const row = data as {
    status: string;
    printful_order_id: number | null;
  } | null;
  if (!row) {
    return "not_ours" as const; // not a PrintPetz order (or never paid)
  }
  if (row.status === "cancelled") {
    return "already" as const;
  }
  // Mark it first: a fulfilment in flight sees 'cancelled' when it finishes and cancels its own
  // Printful order, and the sweep never picks it up again.
  await supabase
    .from(TABLE)
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("shopify_order_id", id);

  let outcome: string[];
  if (!row.printful_order_id) {
    outcome = [
      "It hadn't reached Printful yet, so nothing will be sent to print.",
    ];
  } else {
    const pfStatus = await printfulStatus(row.printful_order_id);
    if (pfStatus && CANCELLABLE.has(pfStatus)) {
      const { ok, status } = await cancelOrder(row.printful_order_id);
      outcome = ok
        ? [
            `Printful order ${row.printful_order_id} was "${pfStatus}" and is now cancelled, so nothing will print. Printful refunds its charge for cancelled orders.`,
          ]
        : [
            `Printful order ${row.printful_order_id} was "${pfStatus}" but cancelling it FAILED (status ${status ?? "unknown"}).`,
            `Cancel it by hand: https://www.printful.com/dashboard?order_id=${row.printful_order_id}`,
          ];
    } else {
      outcome = [
        `Too late to stop: Printful order ${row.printful_order_id} is "${pfStatus ?? "unknown"}" (already in production or shipped).`,
        "It will still be made and delivered. Decide whether the customer keeps it.",
        `Printful: https://www.printful.com/dashboard?order_id=${row.printful_order_id}`,
      ];
    }
  }
  await sendAlert(
    `Order ${name} cancelled`,
    [
      `Shopify order ${name} (id ${id}) was cancelled.`,
      ...outcome,
      order.test === true ? "(Shopify TEST order.)" : "",
    ],
    `cancelled-${id}`,
  );
  return "handled" as const;
};

/** Shopify recorded a refund: say where the print stands; Jake decides (refunds can be partial). */
export const handleRefund = async (refund: {
  id?: unknown;
  order_id?: unknown;
  refund_line_items?: unknown[];
  note?: string;
}) => {
  const id = String(refund.order_id);
  const { data, error } = await supabase
    .from(TABLE)
    .select("order_name, status, printful_order_id, test")
    .eq("shopify_order_id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`merch_orders lookup failed: ${error.message}`);
  }
  const row = data as {
    order_name: string | null;
    status: string;
    printful_order_id: number | null;
    test: boolean;
  } | null;
  if (!row) {
    return "not_ours" as const;
  }
  const name = row.order_name ?? `#${id}`;
  const pfStatus = row.printful_order_id
    ? await printfulStatus(row.printful_order_id)
    : null;
  const items = refund.refund_line_items?.length ?? 0;
  await sendAlert(
    `Refund on order ${name}`,
    [
      `A refund was issued on Shopify order ${name} (id ${id})${items ? ` covering ${items} line item${items === 1 ? "" : "s"}` : " (no items: shipping or an amount only)"}.`,
      refund.note ? `Refund note: ${refund.note}` : "",
      row.status === "cancelled"
        ? "The order is already cancelled."
        : row.printful_order_id
          ? `Printful order ${row.printful_order_id} is "${pfStatus ?? "unknown"}". A refund alone does NOT stop the print. To stop it, cancel the order in Shopify (we then cancel Printful if it hasn't started), or cancel it in Printful: https://www.printful.com/dashboard?order_id=${row.printful_order_id}`
          : "It hasn't reached Printful yet. To stop it, cancel the order in Shopify.",
      row.test ? "(Shopify TEST order.)" : "",
    ],
    `refund-${String(refund.id ?? id)}`,
  );
  return "alerted" as const;
};

let started = false;

export const startShipmentWatcher = () => {
  if (
    started ||
    process.env.PRINTFUL_WATCH === "off" ||
    !process.env.PRINTFUL_API_KEY
  ) {
    return;
  }
  started = true;
  setInterval(() => {
    // Shipments first, so a package that just shipped has its shipped_at before check-ins run.
    checkShipments()
      .then(() => sendCheckIns())
      .catch((error) =>
        addErrorLog({
          input: JSON.stringify({ watcher: "shipments" }),
          error: JSON.stringify({ message: (error as Error).message }),
          type: "SHIPMENT_WATCH",
        }),
      );
  }, EVERY_MS);
};
