/**
 * Make the credit packs on the site match Stripe right now (the webhook normally does this).
 *
 *   npm run build && npm run sync-prices
 *
 * Uses STRIPE_API_KEY from .env: a test key syncs test packs, a live key syncs live packs. Writes to
 * the `prices` table of whichever database .env points at.
 */
import "dotenv/config";

import Stripe from "stripe";

import { syncPricesFromStripe } from "@/services/price_sync_service";

const main = async () => {
  const key = process.env.STRIPE_API_KEY;
  if (!key) {
    throw new Error("STRIPE_API_KEY is not set");
  }
  const result = await syncPricesFromStripe(new Stripe(key));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
