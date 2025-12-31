import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IPurchase } from "@/types/purchase";

import { addErrorLog } from "./error_logs_service";

/**
 * Add a purchase to the database.
 * @param input - The purchase object to add
 * @returns Purchase if the purchase was added, otherwise null
 */
export const addPurchase = async (input: Partial<IPurchase>) => {
  const { data, error } = await retrySupabase<IPurchase>(
    async () =>
      await supabase.from(tables.purchases).insert(input).select("*").single(),
  );

  if (error) {
    addErrorLog({
      input: JSON.stringify(input),
      error: JSON.stringify({ error }),
      type: "ADD_PURCHASE",
    });
    return null;
  }

  return data;
};
