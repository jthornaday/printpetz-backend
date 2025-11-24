import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IPurchaseHistory } from "@/types/purchase_history";
import { IUser } from "@/types/user";

import { addErrorLog } from "./error_logs_service";

export const addPaymentHistory = async (input: Partial<IPurchaseHistory>) => {
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
      input: JSON.stringify(input),
      error: JSON.stringify({ error }),
      type: "ADD_PAYMENT_HISTORY",
    });
    return false;
  }

  return data;
};
