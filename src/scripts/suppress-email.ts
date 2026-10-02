/**
 * Stop follow-up emails to a customer who replied "stop" (specs/merch-reviews-followup.md §6.3).
 *
 *   npm run build && npm run suppress-email -- someone@example.com
 *
 * Writes to the production database (email_suppressions). Tracking emails still go out: they're
 * about an order the customer placed, not follow-ups.
 */
import "dotenv/config";

import { suppressEmail } from "@/services/followup_service";

const main = async () => {
  const email = process.argv[2];
  if (!email || !email.includes("@")) {
    throw new Error("usage: npm run suppress-email -- someone@example.com");
  }
  await suppressEmail(email, "replied stop");
  // eslint-disable-next-line no-console
  console.log(
    `No more follow-up emails will go to ${email.trim().toLowerCase()}.`,
  );
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
