import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { IErrorLog } from "@/types/error_log";

export const addErrorLog = async (input: Partial<IErrorLog>) => {
  const { error } = await supabase.from(tables.errorLogs).insert(input);
  if (error && error.code === "PGRST116") {
    console.log("Error white saving error logs", error);
    return false;
  }

  return true;
};
