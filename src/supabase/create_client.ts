import { createClient, SupabaseClient } from "@supabase/supabase-js";

import AppConstants from "@/constants/app_constants";

/**
 * Create a Supabase client instance
 * @returns {SupabaseClient} The Supabase client instance
 */
export const supabase = createClient(
  AppConstants.supabaseUrl,
  AppConstants.supabaseServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
) as SupabaseClient;

export default supabase;
