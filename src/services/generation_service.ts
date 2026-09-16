import { QwenImageOutput } from "@fal-ai/client/endpoints";

import AppConstants from "@/constants/app_constants";
import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { EUploadPath } from "@/types/aws";
import { TFalImageGenerationResponse } from "@/types/fal";
import { EGenerationStatus, IGeneration } from "@/types/generation";
import errorResponse from "@/utils/errors/errorResponse";

import { uploadFileToS3 } from "./aws_service";
import { addErrorLog } from "./error_logs_service";
import { getFileBufferFromUrl } from "./file_service";
import { updateUserCredit } from "./user_service";

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

  const url = await uploadFileToS3(uploadData);

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
      updateUserCredit(
        generation.user_id,
        AppConstants.imageGenerationCredit,
        true,
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
