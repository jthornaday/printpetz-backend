import { PostgrestSingleResponse } from "@supabase/supabase-js";

export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 500,
): Promise<T | null> => {
  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (result) {
        return result;
      }

      if (attempt === maxRetries) {
        return null;
      }
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
    }

    const waitTime = baseDelay * Math.pow(2, attempt - 1); // 500ms, 1000ms, 2000ms...
    // eslint-disable-next-line no-console
    console.warn(`Retry ${attempt} failed. Retrying in ${waitTime}ms...`);
    await delay(waitTime);
  }

  return null;
};

export const retrySupabase = async <T>(
  fn: () => Promise<PostgrestSingleResponse<T>>,
  retries = 3,
): Promise<PostgrestSingleResponse<T>> => {
  try {
    const result = await fn();

    const retriableStatuses = [408, 425, 429, 500, 502, 503, 504];

    if (
      result.error &&
      retriableStatuses.includes(result.status) &&
      retries > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400 * retries));
      return retrySupabase(fn, retries - 1);
    }

    return result; // success OR non-retriable error
  } catch (err) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400 * retries));
      return retrySupabase(fn, retries - 1);
    }

    throw err; // network-level failure after retries
  }
};
