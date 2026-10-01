import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IUser } from "@/types/user";

import { addErrorLog } from "./error_logs_service";

/**
 * Check if a user exists in the database.
 * @param id - The ID of the user to check
 * @returns The user object if it exists, otherwise throws an error
 */
export const getUser = async (id: string) => {
  const { data, error } = await retrySupabase<IUser>(
    async () =>
      await supabase.from(tables.users).select("*").eq("id", id).single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ id }),
      type: "GET_USER",
    });
    return null;
  }

  return data;
};

/**
 * Get a user by their stripe customer ID.
 * @param stripeCustomerId - The ID of the user's stripe customer
 * @returns The user object if it exists, otherwise throws an error
 */
export const getUserByStripeCustomerId = async (stripeCustomerId: string) => {
  const { data, error } = await retrySupabase<IUser>(
    async () =>
      await supabase
        .from(tables.users)
        .select("*")
        .eq("stripe_customer_id", stripeCustomerId)
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ stripeCustomerId }),
      type: "GET_USER_BY_STRIPE_CUSTOMER_ID",
    });
    return null;
  }

  return data;
};

/**
 * Create a new user.
 * @param user - The user object to create
 * @returns User if the user was created, otherwise null
 */
export const updateUser = async (input: Partial<IUser>) => {
  if (!input.id) {
    return;
  }

  const { id, ...dataToUpdate } = input;
  const { data, error } = await retrySupabase<IUser>(
    async () =>
      await supabase
        .from(tables.users)
        .update(dataToUpdate)
        .eq("id", id)
        .select("*")
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "UPDATE_USER",
    });
    return false;
  }

  return data;
};

/** Everything the user can spend: free starter credits plus paid ones. */
export const availableCredits = (
  user: Pick<IUser, "credits" | "free_credits">,
) => user.credits + (user.free_credits ?? 0);

export type CreditSpend = { freeSpent: number; paidSpent: number };

/**
 * Spend credits atomically, free ones first (Postgres `spend_credits`, one locked row). Returns the
 * split, or null if the balance is short. Idempotent per (kind, ref): retrying a charge returns
 * the original split without charging twice. Throws if the database call itself fails.
 */
export const spendCredits = async (
  userId: string,
  amount: number,
  kind: "training" | "generation",
  ref: string,
): Promise<CreditSpend | null> => {
  const { data, error } = await supabase.rpc("spend_credits", {
    p_user: userId,
    p_amount: amount,
    p_kind: kind,
    p_ref: ref,
  });
  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ userId, amount, kind, ref }),
      type: "SPEND_CREDITS",
    });
    throw new Error(`spend_credits failed: ${error.message}`);
  }
  const row = (
    data as Array<{ free_spent: number; paid_spent: number }> | null
  )?.[0];
  return row ? { freeSpent: row.free_spent, paidSpent: row.paid_spent } : null;
};

/**
 * Give back exactly what a spend took (free to free, paid to paid). Safe to call twice: the second
 * call returns false. A charge from before the ledger existed is returned as `fallbackPaid` paid
 * credits. Never throws: a failed refund is logged for follow-up.
 */
export const refundCharge = async (
  userId: string,
  kind: "training" | "generation",
  ref: string,
  fallbackPaid: number,
) => {
  const { data, error } = await supabase.rpc("refund_charge", {
    p_user: userId,
    p_kind: kind,
    p_ref: ref,
    p_fallback_paid: fallbackPaid,
  });
  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ userId, kind, ref, fallbackPaid }),
      type: "REFUND_CREDITS",
    });
    return false;
  }
  return data === true;
};

/**
 * Add purchased credits once per Stripe checkout session. `applied` is false for a redelivered
 * webhook; `firstPurchase` drives the starter-image unlock.
 */
export const addPaidCredits = async (
  userId: string,
  amount: number,
  sessionId: string,
) => {
  const { data, error } = await supabase.rpc("add_paid_credits", {
    p_user: userId,
    p_amount: amount,
    p_ref: sessionId,
  });
  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ userId, amount, sessionId }),
      type: "ADD_PAID_CREDITS",
    });
    throw new Error(`add_paid_credits failed: ${error.message}`);
  }
  const row = (
    data as Array<{ applied: boolean; first_purchase: boolean }> | null
  )?.[0];
  return {
    applied: Boolean(row?.applied),
    firstPurchase: Boolean(row?.first_purchase),
  };
};
