import { QwenImageOutput } from "@fal-ai/client/endpoints";

import AppConstants from "@/constants/app_constants";
import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { EUploadPath } from "@/types/aws";

/** Marks a generations row as claimed by the in-process worker. */
export const CLAIM_PREFIX = "queued:";

// generations.provider and provider_model arrive in
// add-generations-provider-columns.sql, which Jake runs by hand. Supabase
// rejects an insert naming a column that does not exist, so writing them
// unconditionally would fail EVERY generation on any deploy that reached
// production before the SQL did. The flag makes that ordering impossible to
// get wrong. Off by default; set PRINTPETZ_PROVIDER_COLUMNS=true once the
// columns exist.
const providerColumnsEnabled = () =>
  /^(1|true|yes)$/i.test(process.env.PRINTPETZ_PROVIDER_COLUMNS?.trim() ?? "");

export const providerColumns = (provider: string, providerModel?: string) =>
  providerColumnsEnabled()
    ? { provider, ...(providerModel ? { provider_model: providerModel } : {}) }
    : {};
import { TFalImageGenerationResponse } from "@/types/fal";
import { EGenerationStatus, IGeneration } from "@/types/generation";
import errorResponse from "@/utils/errors/errorResponse";

import { getObjectFromS3, uploadFileToS3 } from "./aws_service";
import { addErrorLog } from "./error_logs_service";
import { getFileBufferFromUrl } from "./file_service";
import { refundCharge } from "./user_service";
import { watermark } from "./watermark_service";

// provider and provider_model are labels, added by
// add-generations-provider-columns.sql. If PRINTPETZ_PROVIDER_COLUMNS is on
// before that SQL has run, PostgREST rejects the whole insert with PGRST204 --
// which on 16 Sept lost 24 images, 22 of them already made and paid for. A
// missing label is not worth a missing image, so drop the labels and insert
// again rather than fail.
const LABEL_COLUMNS = ["provider", "provider_model"];

export const withoutLabelColumns = <T extends object>(input: T): T => {
  if (!LABEL_COLUMNS.some((column) => column in input)) {
    return input;
  }
  const unlabelled = { ...input };
  LABEL_COLUMNS.forEach((column) => delete unlabelled[column]);
  return unlabelled;
};

const insertGeneration = (input: Partial<IGeneration>) =>
  retrySupabase<IGeneration>(
    async () =>
      await supabase
        .from(tables.generations)
        .insert(input)
        .select("*")
        .single(),
  );

export const addGeneration = async (input: Partial<IGeneration>) => {
  let { data, error } = await insertGeneration(input);

  const unlabelled = withoutLabelColumns(input);
  if (error?.code === "PGRST204" && unlabelled !== input) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "ADD_GENERATION_LABEL_COLUMNS",
    });
    ({ data, error } = await insertGeneration(unlabelled));
    input = unlabelled;
  }

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "ADD_GENERATION",
    });
    return null;
  }

  return data;
};

export const getGenerationById = async (id: number) => {
  const { data, error } = await retrySupabase<IGeneration>(
    async () =>
      await supabase.from(tables.generations).select("*").eq("id", id).single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ id }),
      type: "GET_GENERATION_BY_ID",
    });
    return null;
  }

  return data;
};

export const getGenerationByRequestId = async (requestId: string) => {
  const { data, error } = await retrySupabase<IGeneration>(
    async () =>
      await supabase
        .from(tables.generations)
        .select("*")
        .eq("request_id", requestId)
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ requestId }),
      type: "GET_GENERATION_BY_REQUEST_ID",
    });
    return null;
  }

  return data;
};

export const updateGeneration = async (input: Partial<IGeneration>) => {
  if (!input.id) {
    return;
  }

  const { id, ...dataToUpdate } = input;
  const { data, error } = await retrySupabase<IGeneration>(
    async () =>
      await supabase
        .from(tables.generations)
        .update(dataToUpdate)
        .eq("id", id)
        .select("*")
        .single(),
  );

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify(input),
      type: "UPDATE_GENERATION",
    });
    return false;
  }

  return data;
};

export const deleteGenerationForUser = async (id: number, userId: string) => {
  const { data, error } = await supabase
    .from(tables.generations)
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ id, userId }),
      type: "DELETE_GENERATION",
    });
    throw error;
  }

  return Boolean(data);
};

/**
 * Did this image use free starter credits? Read from its ledger row (credit_ledger is server-only).
 * If the lookup fails we can't prove it was paid for, so it counts as free and gets watermarked:
 * the clean original is kept, so a wrong watermark can be undone, a leaked clean image can't.
 */
const usedFreeCredits = async (generationId: number) => {
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("free_delta")
    .eq("kind", "generation")
    .eq("ref", String(generationId))
    .maybeSingle();
  if (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ generationId }),
      type: "FREE_CREDIT_LOOKUP",
    });
    return true;
  }
  return Boolean(data && (data as { free_delta: number }).free_delta < 0);
};

/**
 * The URL the customer gets for a finished image. Paid images: the clean upload itself. Images
 * made with free credits: a watermarked copy at a new key, with the clean original's key recorded
 * in generation_assets (server-only) so products and the first-purchase unlock can use it. The
 * clean key is random and never sent to the browser.
 */
export const customerImageUrl = async (
  generation: Pick<IGeneration, "id" | "user_id">,
  clean: {
    url: string;
    buffer: Buffer;
    contentType: string;
    extension: string;
  },
) => {
  if (!(await usedFreeCredits(generation.id))) {
    return clean.url;
  }
  const marked = await uploadGenerationImageBuffer(
    generation.user_id,
    await watermark(clean.buffer),
    clean.contentType,
    clean.extension,
  );
  if (!marked) {
    throw new Error(
      `watermarked copy of generation ${generation.id} could not be stored`,
    );
  }
  const { error } = await supabase.from("generation_assets").upsert({
    generation_id: generation.id,
    original_key: clean.url.replace(`${AppConstants.cloudfrontDomain}/`, ""),
  });
  if (error) {
    throw new Error(
      `generation_assets write failed for ${generation.id}: ${error.message}`,
    );
  }
  return marked;
};

/**
 * The clean bytes of a generation, for printing and shop previews, and whether the customer's own
 * copy is currently watermarked (made with free credits and not yet unlocked by a purchase).
 * Products always print from these bytes, never from the watermarked copy.
 */
export const cleanSourceFor = async (
  generation: Pick<IGeneration, "id" | "image">,
) => {
  const { data, error } = await supabase
    .from("generation_assets")
    .select("original_key, unlocked_at")
    .eq("generation_id", generation.id)
    .maybeSingle();
  if (error) {
    throw new Error(
      `generation_assets lookup failed for ${generation.id}: ${error.message}`,
    );
  }
  const asset = data as {
    original_key: string | null;
    unlocked_at: string | null;
  } | null;
  if (asset?.original_key) {
    const buffer = await getObjectFromS3(asset.original_key);
    if (!buffer) {
      throw new Error(`clean original missing for generation ${generation.id}`);
    }
    return { buffer, watermarked: !asset.unlocked_at };
  }
  if (!generation.image) {
    throw new Error(`generation ${generation.id} has no image`);
  }
  const res = await fetch(generation.image);
  if (!res.ok) {
    throw new Error(
      `generation image fetch failed ${res.status} for ${generation.id}`,
    );
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), watermarked: false };
};

/**
 * Buying credits unlocks the customer's watermarked images (Jake, option b): each one's row is
 * pointed back at its clean original. Runs on every purchase, so an unlock interrupted part-way is
 * finished by the next one. Returns how many images were unlocked.
 */
export const unlockFreeImages = async (userId: string) => {
  const { data, error } = await supabase
    .from("generation_assets")
    .select("generation_id, original_key, generations!inner(user_id)")
    .eq("generations.user_id", userId)
    .is("unlocked_at", null)
    .not("original_key", "is", null);
  if (error) {
    throw new Error(`unlock lookup failed for ${userId}: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<{
    generation_id: number;
    original_key: string;
  }>;
  for (const row of rows) {
    // Point the customer's copy at the clean original first, then mark it unlocked: a crash in
    // between leaves it clean but still listed, and the next purchase just repeats the update.
    await updateGeneration({
      id: row.generation_id,
      image: `${AppConstants.cloudfrontDomain}/${row.original_key}`,
    });
    const { error: markError } = await supabase
      .from("generation_assets")
      .update({ unlocked_at: new Date().toISOString() })
      .eq("generation_id", row.generation_id);
    if (markError) {
      throw new Error(
        `unlock mark failed for ${row.generation_id}: ${markError.message}`,
      );
    }
  }
  return rows.length;
};

/**
 * Upload an image we already hold in memory and return its CloudFront URL.
 *
 * The FAL lane never needs this: fal hands back a URL and
 * handleImageUploadAndSave streams it across. A synchronous provider returns
 * the bytes themselves, and the row cannot be inserted until they have a home,
 * so the upload has to happen before the insert rather than after it.
 */
export const uploadGenerationImageBuffer = async (
  userId: string,
  buffer: Buffer,
  contentType: string,
  extension: string,
) => {
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extension}`;

  return uploadFileToS3({
    buffer,
    fileType: contentType,
    Key: `${EUploadPath.GENERATION_IMAGE.replace("[USER_ID]", userId)}/${fileName}`,
  });
};

/**
 * Claim one queued generation for this worker, atomically.
 *
 * Queued rows are inserted with request_id null. Setting it is the claim, and
 * the `is("request_id", null)` predicate makes that conditional: two workers
 * racing for the same row, or a worker racing its own restart, produce exactly
 * one winner and one empty result. No advisory lock, no extra column.
 *
 * FAL rows always carry a request_id from the moment they are inserted, so
 * "request_id is null" is precisely the set of rows nobody has started.
 */
export const claimQueuedGeneration = async (claimToken: string) => {
  const { data: candidates } = await retrySupabase<IGeneration[]>(
    async () =>
      await supabase
        .from(tables.generations)
        .select("*")
        .eq("status", EGenerationStatus.GENERATING)
        .is("request_id", null)
        .is("image", null)
        .order("id")
        .limit(1),
  );

  const candidate = (candidates as unknown as IGeneration[])?.[0];
  if (!candidate) {
    return null;
  }

  const { data } = await retrySupabase<IGeneration>(
    async () =>
      await supabase
        .from(tables.generations)
        .update({ request_id: claimToken })
        .eq("id", candidate.id)
        .is("request_id", null)
        .select("*")
        .single(),
  );

  return (data as IGeneration) ?? null;
};

/**
 * Rows that were claimed or queued and never finished -- a process killed
 * mid-batch, a deploy, an EB restart. Age is read from group_id, which is
 * Date.now() at batch creation, so this needs no timestamp column.
 */
export const findStrandedGenerations = async (olderThanMs: number) => {
  const cutoff = Date.now() - olderThanMs;

  const { data } = await retrySupabase<IGeneration[]>(
    async () =>
      await supabase
        .from(tables.generations)
        .select("*")
        .eq("status", EGenerationStatus.GENERATING)
        .is("image", null)
        .lt("group_id", cutoff),
  );

  // FAL rows are finished by their webhook and must not be swept out from
  // under it. Only rows this worker owns -- queued (null) or claimed -- qualify.
  return ((data as unknown as IGeneration[]) ?? []).filter(
    (row) => row.request_id === null || row.request_id.startsWith(CLAIM_PREFIX),
  );
};

/**
 * Unfinished QUEUED work for one user, for the double-submission guard.
 *
 * Deliberately not "all unfinished work". A FAL row waits on a webhook that
 * may never arrive, and counting those would let one stranded row from months
 * ago lock a customer out of generating forever. Only rows this worker owns --
 * queued (null request_id) or claimed -- can block a new batch, and the sweep
 * clears those within its threshold no matter what happens to the process.
 */
export const countUnfinishedGenerations = async (userId: string) => {
  const { data } = await retrySupabase<IGeneration[]>(
    async () =>
      await supabase
        .from(tables.generations)
        .select("*")
        .eq("user_id", userId)
        .eq("status", EGenerationStatus.GENERATING)
        .is("image", null),
  );

  return ((data as unknown as IGeneration[]) ?? []).filter(
    (row) => row.request_id === null || row.request_id.startsWith(CLAIM_PREFIX),
  ).length;
};

const handleImageUploadAndSave = async (
  image: QwenImageOutput["images"][number],
  generation: IGeneration,
  falSeed?: number,
) => {
  const fileName = image.url?.split("/").at(-1);
  const fileType = image.content_type;

  const buffer = await getFileBufferFromUrl(image.url, fileType);

  const uploadData = {
    buffer,
    fileType,
    Key: `${EUploadPath.GENERATION_IMAGE.replace("[USER_ID]", generation.user_id)}/${fileName}`,
  };

  const cleanUrl = await uploadFileToS3(uploadData);
  const url = cleanUrl
    ? await customerImageUrl(generation, {
        url: cleanUrl,
        buffer,
        contentType: fileType,
        extension: fileName?.split(".").at(-1) ?? "jpg",
      })
    : null;

  if (url) {
    // The seed is already recorded at insert time. Only overwrite it if fal
    // reports a different one, which would mean fal ignored the seed we sent.
    if (falSeed !== undefined && falSeed !== generation.seed) {
      addErrorLog({
        error: JSON.stringify({ sent: generation.seed, used: falSeed }),
        input: JSON.stringify({ generationId: generation.id }),
        type: "SEED_MISMATCH",
      });
    }

    await updateGeneration({
      id: generation.id,
      status: EGenerationStatus.COMPLETED,
      image: url,
      ...(falSeed !== undefined ? { seed: falSeed } : {}),
    });
  }
};

export const handleImageGenerationResponse = async (
  reqBody: TFalImageGenerationResponse,
) => {
  const { request_id, status, payload } = reqBody;

  const generation = await getGenerationByRequestId(request_id);
  if (!generation) {
    throw errorResponse.Api404Error({
      errorDescription: `Generation not found with this request-id`,
    });
  }

  if (status === "ERROR") {
    await Promise.all([
      updateGeneration({
        id: generation.id,
        status: EGenerationStatus.ERROR,
        error: payload?.details?.[0],
      }),
      refundCharge(
        generation.user_id,
        "generation",
        String(generation.id),
        AppConstants.imageGenerationCredit,
      ),
    ]);

    return true;
  }

  if (status === "OK") {
    const image = payload?.images?.[0];
    if (!image) {
      throw errorResponse.Api400Error({
        errorDescription: "image data required",
      });
    }

    await handleImageUploadAndSave(image, generation, payload?.seed);
    return true;
  }

  addErrorLog({
    error: JSON.stringify(reqBody),
    input: JSON.stringify(reqBody),
    type: "UNEXPECTED_IMAGE_GENERATION_RESPONSE",
  });

  return false;
};
