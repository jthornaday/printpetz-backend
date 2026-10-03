/**
 * Emails Jake when money was taken but something didn't print (launch checklist A2).
 *
 * Two sources: the Shopify order webhook (an order we couldn't process) and a watcher that asks
 * Printful for orders stuck in "failed" or "on hold" (a declined card stopped the bowl samples on
 * 2026-09-30 and nobody knew). Plain-text email via Resend. Every alert has a dedupe key and goes
 * out at most once per key per day, so several servers, retries or a stuck order can't flood the
 * inbox — but a problem still unresolved tomorrow is mailed again.
 */
import { sendEmail } from "./email_service";
import { addErrorLog } from "./error_logs_service";

// Jake's own inbox. Deliberately NOT the public support address (constants/support.ts), so alerts
// keep reaching him if that address changes.
const OWNER_INBOX = "myprintpetz@gmail.com";
export const alertRecipient = () =>
  process.env.ALERT_EMAIL?.trim() || OWNER_INBOX;

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Send one alert. Never throws: an alert failure must not break the order path it reports on. */
export const sendAlert = async (
  subject: string,
  lines: string[],
  dedupeKey: string,
) => {
  const day = new Date().toISOString().slice(0, 10);
  const text = [...lines, "", "— PrintPetz order alerts"].join("\n");
  try {
    return await sendEmail({
      to: alertRecipient(),
      subject: `[PrintPetz alert] ${subject}`,
      text,
      html: `<pre style="font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      idempotencyKey: `alert-${dedupeKey}-${day}`.slice(0, 256),
      tags: [{ name: "category", value: "order_alert" }],
    });
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ subject, dedupeKey }),
      error: JSON.stringify({ message: (error as Error).message }),
      type: "ALERT_SEND_FAILED",
    });
    return false;
  }
};
