import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IStyle } from "@/types/style";

import { addErrorLog } from "./error_logs_service";

export const getStyleById = async (id: number) => {
  const { data, error } = await retrySupabase<IStyle>(
    async () =>
      await supabase.from(tables.styles).select("*").eq("id", id).single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ id }),
      type: "GET_STYLE_BY_ID",
    });
    return null;
  }

  return data;
};

export const updateStyle = async (input: Partial<IStyle>) => {
  if (!input.id) {
    return;
  }

  const { id, ...dataToUpdate } = input;
  const { data, error } = await retrySupabase<IStyle>(
    async () =>
      await supabase
        .from(tables.styles)
        .update(dataToUpdate)
        .eq("id", id)
        .select("*")
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "UPDATE_STYLE",
    });
    return null;
  }

  return data;
};
