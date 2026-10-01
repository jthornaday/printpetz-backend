import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import { handleTrainModel } from "@/services/fal_service";
import { addModel, getModelById, updateModel } from "@/services/model_service";
import { availableCredits, spendCredits } from "@/services/user_service";
import { EModelStatus } from "@/types/model";
import errorResponse from "@/utils/errors/errorResponse";
import { createTrainingZip } from "@/utils/fal_utils";
import { modelTrainingSchema } from "@/utils/validation/model_training_validation_schema";

const trainModel = AsyncHandler.handle(async (req, res) => {
  const user = req.user;
  const { images, name, petName, petDescription } = modelTrainingSchema.parse(req.body);
  const resolvedPetName = petName?.trim() || name.trim();

  const modelTrainingCharge = AppConstants.modelTrainingCredit;
  const hasEnoughCredit = availableCredits(user) >= modelTrainingCharge;

  if (!hasEnoughCredit) {
    throw errorResponse.Api403Error({
      errorDescription: "You don`t have sufficient credits to train model",
    });
  }

  const imagesBlob = await createTrainingZip({ imageUrls: images });
  const requestId = await handleTrainModel(imagesBlob, name);

  // Keyed by the training request, so the failure webhook can refund exactly this charge. A short
  // balance here means another spend raced past the check above; don't create a pet nobody paid for.
  const spend = await spendCredits(user.id, modelTrainingCharge, "training", requestId);
  if (!spend) {
    throw errorResponse.Api403Error({
      errorDescription: "You don`t have sufficient credits to train model",
    });
  }

  const model = await addModel({
    user_id: user.id,
    name,
    pet_name: resolvedPetName,
    pet_description: petDescription?.trim() || null,
    request_id: requestId,
    status: EModelStatus.TRAINING,
    training_images: images,
  });

  res.dataCreateSuccess({ data: { model } });
});

const deleteModel = AsyncHandler.handle(async (req, res) => {
  const modelId = Number(req.params.id);
  if (!Number.isInteger(modelId) || modelId <= 0) {
    throw errorResponse.Api400Error({ errorDescription: "Invalid model id" });
  }

  const model = await getModelById(modelId);
  if (!model || model.user_id !== req.user.id) {
    throw errorResponse.Api404Error({ errorDescription: "Model not found" });
  }

  if (model.status === EModelStatus.TRAINING) {
    throw errorResponse.Api400Error({
      errorDescription: "Model is still training and can't be deleted yet",
    });
  }

  const updated = await updateModel({ id: model.id, is_deleted: true });
  if (!updated) {
    throw errorResponse.Api500Error({
      errorDescription: "Failed to delete model",
    });
  }

  res.dataUpdateSuccess();
});

export { deleteModel, trainModel };
