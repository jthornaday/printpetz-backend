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
