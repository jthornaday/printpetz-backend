import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IPrice } from "@/types/price";
import errorResponse from "@/utils/errors/errorResponse";

import { addErrorLog } from "./error_logs_service";

/**
 * Check if a price exists in the database.
 * @param priceId - The price ID of the price to check
 * @returns The price object if it exists, otherwise throws an error
 */
export const getPriceByPriceId = async (priceId: string) => {
  const { data, error } = await retrySupabase<IPrice>(
    async () =>
      await supabase
        .from(tables.prices)
        .select("*")
        .eq("price_id", priceId)
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ priceId }),
      type: "GET_PRICE_BY_PRICE_ID",
    });
    return null;
  }

  return data;
};

/**
 * Create a new price.
 * @param input - The price object to create
 * @returns Price if the price was created, otherwise null
 */
export const createPrice = async (input: Partial<IPrice>) => {
  const { data, error } = await retrySupabase<IPrice>(
    async () =>
      await supabase.from(tables.prices).insert(input).select("*").single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "CREATE_PRICE",
    });
    return null;
  }

  return data;
};

/**
 * Update a price.
 * @param input - The price object to update
 * @returns Price if the price was updated, otherwise null
 */
export const updatePrice = async (input: Partial<IPrice>) => {
  if (!input.price_id) {
    throw errorResponse.Api400Error({
      errorDescription: "price_id is required",
    });
  }

  const { price_id, ...dataToUpdate } = input;

  const { data, error } = await retrySupabase<IPrice>(
    async () =>
      await supabase
        .from(tables.prices)
        .update(dataToUpdate)
        .eq("price_id", price_id)
        .select("*")
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "UPDATE_PRICE",
    });
    return null;
  }

  return data;
};

/**
 * Delete a price.
 * @param priceId - The price ID of the price to delete
 * @returns Price if the price was deleted, otherwise null
 */
export const deletePrice = async (priceId: string) => {
  const { error } = await retrySupabase<IPrice>(
    async () =>
      await supabase.from(tables.prices).delete().eq("price_id", priceId),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ priceId }),
      type: "DELETE_PRICE",
    });
    return false;
  }

  return true;
};
