/**
 * Durable intake for paid Shopify orders (launch checklist A2, part 2).
 *
 * The webhook records an order here before answering Shopify, then fulfils it. Every attempt ends
 * by marking the row: 'fulfilled', back to 'received' for another try, or 'failed' after
 * MAX_ATTEMPTS with an alert. A sweep picks up rows left behind — 'received' (retry due) or stuck in
 * 'processing' (the server restarted mid-order) — so a paid order can't be silently lost.
 * Printful's external-id lookup keeps a retry from printing twice.
 *
 * Table: supabase/migrations/20261004_merch_orders.sql (server-only).
 */
import supabase from "@/supabase/create_client";

import { sendAlert } from "./alert_service";
import { addErrorLog } from "./error_logs_service";
import { createFulfillmentOrder, FulfillmentRequest } from "./printful_service";

const TABLE = "merch_orders";
export const MAX_ATTEMPTS = 3;
const SWEEP_EVERY_MS = 2 * 60_000;

type MerchOrderRow = {
  shopify_order_id: string;
  order_name: string | null;
  request: FulfillmentRequest | null;
  attempts: number;
  test: boolean;
};

/**
 * Record a paid order and claim it for this server's first attempt. Returns false if it was
 * already recorded (Shopify redelivered the webhook): the earlier delivery or the sweep owns it.
 * Throws if the database write fails, so the webhook can answer 500 and Shopify retries.
 */
export const recordOrder = async (
  order: { id: unknown; name?: string; test?: boolean },
  request: FulfillmentRequest,
) => {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        shopify_order_id: String(order.id),
        order_name: order.name ?? null,
        status: "processing",
        attempts: 1,
        request,
        test: order.test === true,
      },
      { onConflict: "shopify_order_id", ignoreDuplicates: true },
    )
    .select("shopify_order_id");
  if (error) {
    throw new Error(`merch_orders insert failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
};

/** Keep a record of orders we could never fulfil (the alert has already gone out). */
export const recordUnfulfillable = async (
  order: { id: unknown; name?: string; test?: boolean },
  reason: string,
) => {
  const { error } = await supabase.from(TABLE).upsert(
    {
      shopify_order_id: String(order.id),
      order_name: order.name ?? null,
      status: "unfulfillable",
      last_error: reason,
      test: order.test === true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shopify_order_id" },
  );
  if (error) {
    addErrorLog({
      input: JSON.stringify({ shopifyOrderId: order.id }),
      error: JSON.stringify(error),
      type: "MERCH_ORDER_RECORD",
    });
  }
};

const mark = async (id: string, fields: Record<string, unknown>) => {
  const { error } = await supabase
    .from(TABLE)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("shopify_order_id", id);
  if (error) {
    // The row stays 'processing' and the sweep revisits it; Printful's external-id lookup then
    // finds the order already made instead of printing it twice.
    addErrorLog({
      input: JSON.stringify({ id, fields }),
      error: JSON.stringify(error),
      type: "MERCH_ORDER_MARK",
    });
  }
};

/** One fulfilment attempt for a claimed order. Never throws. */
export const attemptFulfillment = async (row: MerchOrderRow) => {
  const id = row.shopify_order_id;
  if (!row.request) {
    await mark(id, { status: "failed", last_error: "no request recorded" });
    return "failed" as const;
  }
  try {
    const result = await createFulfillmentOrder(row.request);
    await mark(id, {
      status: "fulfilled",
      printful_order_id: result.orderId ?? null,
      last_error: null,
    });
    console.log(
      "[merch-order] fulfilled",
      JSON.stringify({
        shopifyOrderId: id,
        printfulOrderId: result.orderId,
        created: result.created,
        attempt: row.attempts,
      }),
    );
    return "fulfilled" as const;
  } catch (error) {
    const message = (error as Error).message;
    addErrorLog({
      // The full request, so the order can also be replayed by hand.
      input: JSON.stringify({
        shopifyOrderId: id,
        attempt: row.attempts,
        request: row.request,
      }),
      error: JSON.stringify({ message }),
      type: "SHOPIFY_FULFILLMENT_FAILED",
    });
    if (row.attempts < MAX_ATTEMPTS) {
      await mark(id, { status: "received", last_error: message });
      return "retry" as const;
    }
    await mark(id, { status: "failed", last_error: message });
    await sendAlert(
      `Paid order ${row.order_name ?? id} failed to reach Printful`,
      [
        `Shopify order ${row.order_name ?? ""} (id ${id}) was paid, but creating its Printful order failed ${row.attempts} times.`,
        `Last error: ${message}`,
        "",
        "Nothing prints for this customer until it's fixed. The request is in merch_orders and error_logs",
        "(type SHOPIFY_FULFILLMENT_FAILED); after fixing the cause, set its status back to 'received'",
        "and the sweep retries it, or replay it with npm run replay-order.",
        row.test ? "(This was a Shopify TEST order.)" : "",
      ],
      `fulfillment-failed-${id}`,
    );
    return "failed" as const;
  }
};

/** Retry everything due: 'received' rows after 2 minutes, 'processing' rows idle for 15. */
export const sweepOrders = async () => {
  const { data, error } = await supabase.rpc("claim_merch_orders", {
    p_limit: 5,
    p_received_after: "2 minutes",
    p_stuck_after: "15 minutes",
  });
  if (error) {
    throw new Error(`claim_merch_orders failed: ${error.message}`);
  }
  const rows = (data ?? []) as MerchOrderRow[];
  for (const row of rows) {
    await attemptFulfillment(row);
  }
  return rows.length;
};

let started = false;

export const startOrderSweeper = () => {
  if (started) {
    return;
  }
  started = true;
  setInterval(() => {
    sweepOrders().catch((error) =>
      addErrorLog({
        input: JSON.stringify({ sweeper: "merch_orders" }),
        error: JSON.stringify({ message: (error as Error).message }),
        type: "MERCH_ORDER_SWEEP",
      }),
    );
  }, SWEEP_EVERY_MS);
};
