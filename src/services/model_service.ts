import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IModel } from "@/types/model";

import { addErrorLog } from "./error_logs_service";

export const getModelById = async (id: number) => {
  const { data, error } = await retrySupabase<IModel>(
    async () =>
      await supabase
        .from(tables.models)
        .select("*")
        .eq("id", id)
        .is("is_deleted", false)
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ id }),
      type: "GET_MODEL_BY_ID",
    });
    return null;
  }

  return data;
};

export const addModel = async (input: Partial<IModel>) => {
  const { data, error } = await retrySupabase<IModel>(
    async () =>
      await supabase.from(tables.models).insert(input).select("*").single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "ADD_MODEL",
    });
    return null;
  }

  return data;
};

export const getModelByRequestId = async (requestId: string) => {
  const { data, error } = await retrySupabase<IModel>(
    async () =>
      await supabase
        .from(tables.models)
        .select("*")
        .eq("request_id", requestId)
        .is("is_deleted", false)
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ requestId }),
      type: "GET_MODEL_BY_REQUEST_ID",
    });
    return null;
  }

  return data;
};

export const updateModel = async (input: Partial<IModel>) => {
  if (!input.id) {
    return;
  }

  const { id, ...dataToUpdate } = input;
  const { data, error } = await retrySupabase<IModel>(
    async () =>
      await supabase
        .from(tables.models)
        .update(dataToUpdate)
        .eq("id", id)
        .is("is_deleted", false)
        .select("*")
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "UPDATE_MODEL",
    });
    return false;
  }

  return data;
};
