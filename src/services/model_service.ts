import AppConstants from "@/constants/app_constants";
import { retrySupabase } from "@/context/retry";
import supabase from "@/supabase/create_client";
import { tables } from "@/supabase/tables";
import { EUploadPath } from "@/types/aws";
import { TFalModelTrainingResponse } from "@/types/fal";
import { EModelStatus, IModel } from "@/types/model";
import errorResponse from "@/utils/errors/errorResponse";

import { streamUploadToS3 } from "./aws_service";
import { addErrorLog } from "./error_logs_service";
import { updateUserCredit } from "./user_service";

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

const handleModelUploadAndSave = async (
  modelUrl: string,
  model: IModel,
  provider: "flux" | "qwen",
) => {
  const fileName = modelUrl?.split("/").at(-1);
  const fileType = "binary/octet-stream";

  const uploadData = {
    url: modelUrl,
    fileType,
    Key: `${EUploadPath.MODEL.replace("[USER_ID]", model.user_id)}/${provider}/${fileName}`,
  };

  const startAt = Date.now();

  const url = await streamUploadToS3(uploadData);

  console.log({ url, timeTaken: `${(Date.now() - startAt) / 1000}s` });

  if (url) {
    await updateModel({
      id: model.id,
      status: EModelStatus.COMPLETED,
      model_path: url,
    });
  }
};

export const handleModelTrainingResponse = async (
  reqBody: TFalModelTrainingResponse,
) => {
  const model = await getModelByRequestId(reqBody.request_id);
  if (!model) {
    throw errorResponse.Api404Error({
      errorDescription: `Model not found with this request-id`,
    });
  }

  if (reqBody.status === "ERROR") {
    await Promise.all([
      updateModel({
        id: model.id,
        status: EModelStatus.ERROR,
        error: reqBody.payload?.details?.[0],
      }),
      updateUserCredit(model.user_id, AppConstants.modelTrainingCredit, true),
    ]);

    return true;
  }

  if (reqBody.status === "OK") {
    const fluxModelUrl = reqBody.payload?.diffusers_lora_file?.url;
    const qwenModelUrl = reqBody.payload?.lora_file?.url;
    const modelUrl = fluxModelUrl ?? qwenModelUrl;

    if (!modelUrl) {
      throw errorResponse.Api400Error({
        errorDescription: "model url required",
      });
    }

    // Process upload in background to avoid webhook timeout
    handleModelUploadAndSave(modelUrl, model, fluxModelUrl ? "flux" : "qwen");

    return true;
  }

  addErrorLog({
    error: JSON.stringify(reqBody),
    input: JSON.stringify(reqBody),
    type: "UNEXPECTED_MODEL_TRAINING_RESPONSE",
  });

  return true;
};
