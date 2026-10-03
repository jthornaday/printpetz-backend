/**
 * Credit packs, synced from Stripe as a whole (launch, 2026-10-02).
 *
 * Packs used to arrive one webhook at a time, reading only the PRICE's metadata. At the live
 * switch the metadata went on the product instead, never arrived, and the packs showed 0 credits.
 * Now any price or product event re-reads every price from Stripe and makes `prices` match:
 *
 * - metadata (name, credits, popular, description) from the price, falling back to the product;
 * - a pack is on sale only if the price AND its product are active and it grants credits;
 * - rows from our Stripe mode that Stripe no longer lists as active are switched off (never deleted);
 * - any failure throws, so the webhook answers an error and Stripe retries.
 *
 * Jake's workflow is unchanged: edit in the Stripe dashboard and the site follows.
 */
import type Stripe from "stripe";

import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IPrice } from "@/types/price";

type PriceRow = Omit<IPrice, "id">;

/** The row a Stripe price should have. Price metadata wins over the product's, key by key. */
export const rowForStripePrice = (price: Stripe.Price): PriceRow => {
  const product =
    typeof price.product === "object" &&
    price.product &&
    !("deleted" in price.product && price.product.deleted)
      ? (price.product as Stripe.Product)
      : null;
  const meta = {
    ...(product?.metadata ?? {}),
    ...stripMissing(price.metadata ?? {}),
  };
  const credits = Number(meta.credits ?? 0);
  return {
    price_id: price.id,
    name: meta.name ?? product?.name ?? null,
    description: meta.description ?? null,
    credits: Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0,
    amount: (price.unit_amount ?? 0) / 100,
    currency: price.currency,
    is_active: price.active && (product?.active ?? false) && credits > 0,
    is_test_mode: !price.livemode,
    // Typed by hand in the Stripe dashboard: accept true / yes / 1 in any capitals.
    is_most_popular: ["true", "yes", "1"].includes(
      (meta.popular ?? "").trim().toLowerCase(),
    ),
  };
};

/** Drop empty metadata values so a blank price field doesn't hide the product's value. */
const stripMissing = (m: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(m).filter(([, v]) => v !== undefined && v !== ""),
  );

/** Insert or update one row by price_id (no unique constraint is assumed on the table). */
const writeRow = async (row: PriceRow) => {
  const { data: existing, error: readError } = await supabase
    .from(tables.prices)
    .select("id")
    .eq("price_id", row.price_id)
    .maybeSingle();
  if (readError) {
    throw new Error(
      `prices read failed for ${row.price_id}: ${readError.message}`,
    );
  }
  const { error } = existing
    ? await supabase
        .from(tables.prices)
        .update(row)
        .eq("price_id", row.price_id)
    : await supabase.from(tables.prices).insert(row);
  if (error) {
    throw new Error(
      `prices write failed for ${row.price_id}: ${error.message}`,
    );
  }
};

/**
 * Make `prices` match Stripe for the key's mode. Returns what changed, for logs and the script.
 * Only one-off prices are considered (credit packs); recurring prices are ignored.
 */
export const syncPricesFromStripe = async (stripe: Stripe) => {
  const seen = new Set<string>();
  const rows: PriceRow[] = [];
  let livemode: boolean | null = null;
  for await (const price of stripe.prices.list({
    type: "one_time",
    limit: 100,
    expand: ["data.product"],
  })) {
    livemode = price.livemode;
    seen.add(price.id);
    rows.push(rowForStripePrice(price));
  }
  for (const row of rows) {
    await writeRow(row);
  }

  // Rows from this mode that Stripe no longer lists (deleted prices) come off sale. When Stripe
  // listed nothing we can't tell the mode, so we leave the table alone rather than guess.
  let switchedOff = 0;
  if (livemode !== null) {
    const { data, error } = await supabase
      .from(tables.prices)
      .select("price_id")
      .eq("is_test_mode", !livemode)
      .eq("is_active", true);
    if (error) {
      throw new Error(`prices list failed: ${error.message}`);
    }
    for (const { price_id } of (data ?? []) as Array<{ price_id: string }>) {
      if (!seen.has(price_id)) {
        const { error: offError } = await supabase
          .from(tables.prices)
          .update({ is_active: false })
          .eq("price_id", price_id);
        if (offError) {
          throw new Error(
            `prices switch-off failed for ${price_id}: ${offError.message}`,
          );
        }
        switchedOff++;
      }
    }
  }
  return {
    synced: rows.length,
    onSale: rows
      .filter((r) => r.is_active)
      .map(
        (r) => `${r.name ?? r.price_id} (${r.credits} credits, $${r.amount})`,
      ),
    switchedOff,
  };
};
