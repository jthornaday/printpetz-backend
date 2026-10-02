/**
 * Watches Printful for orders that won't print without someone stepping in: "failed" (for example
 * a declined card, which stopped the bowl samples on 2026-09-30 with no warning) and "onhold".
 * Every 15 minutes it lists those orders and emails an alert for each. sendAlert's daily dedupe
 * means one email per order per day until it's resolved, however many servers run this.
 *
 * Read-only against Printful. Disable with PRINTFUL_WATCH=off.
 */
import { sendAlert } from "./alert_service";
import { addErrorLog } from "./error_logs_service";
import { printfulFetch } from "./printful_service";

const EVERY_MS = 15 * 60_000;
const FIRST_RUN_MS = 60_000;
const WATCHED = ["failed", "onhold"] as const;

type PrintfulOrderSummary = {
  id: number;
  external_id?: string | null;
  status: string;
  error?: string | null;
  recipient?: { name?: string };
  costs?: { total?: string };
};

const describe = (o: PrintfulOrderSummary) => [
  `Printful order ${o.id} is "${o.status}".`,
  o.error ? `Printful says: ${o.error}` : "",
  o.external_id
    ? `Order reference: ${o.external_id} (the Shopify order id, for shop orders)`
    : "No order reference (a manual order, e.g. a sample).",
  o.recipient?.name ? `Ship to: ${o.recipient.name}` : "",
  o.costs?.total ? `Printful charge: $${o.costs.total}` : "",
  "",
  `Open it: https://www.printful.com/dashboard?order_id=${o.id}`,
  o.status === "failed"
    ? "A failed order won't print until it's fixed (often billing) and confirmed again."
    : "An on-hold order won't print until the hold is cleared in Printful.",
];

export const checkPrintfulOrders = async () => {
  let alerted = 0;
  for (const status of WATCHED) {
    const { status: http, json } = await printfulFetch(
      `/orders?status=${status}&limit=100`,
    );
    if (http !== 200) {
      throw new Error(`Printful order list (${status}) returned ${http}`);
    }
    const orders = (
      (json as { result?: PrintfulOrderSummary[] }).result ?? []
    ).filter((o) => o.status === status);
    for (const o of orders) {
      await sendAlert(
        `Printful order ${o.id} ${o.status === "onhold" ? "is on hold" : "has failed"}`,
        describe(o).filter((line, i, all) => line !== "" || all[i - 1] !== ""),
        `printful-${o.id}-${o.status}`,
      );
      alerted++;
    }
  }
  return alerted;
};

let started = false;

export const startPrintfulWatcher = () => {
  if (
    started ||
    process.env.PRINTFUL_WATCH === "off" ||
    !process.env.PRINTFUL_API_KEY
  ) {
    return;
  }
  started = true;
  const run = () =>
    checkPrintfulOrders().catch((error) =>
      addErrorLog({
        input: JSON.stringify({ watcher: "printful" }),
        error: JSON.stringify({ message: (error as Error).message }),
        type: "PRINTFUL_WATCH",
      }),
    );
  setTimeout(() => {
    void run();
    setInterval(() => void run(), EVERY_MS);
  }, FIRST_RUN_MS);
};
