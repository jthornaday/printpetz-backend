import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import { handleTrainModel } from "@/services/fal_service";
import { addModel } from "@/services/model_service";
import { updateUser } from "@/services/user_service";
import { EModelStatus } from "@/types/model";
import errorResponse from "@/utils/errors/errorResponse";
import { createTrainingZip } from "@/utils/fa_utils";
import { modelTrainingSchema } from "@/utils/validation/model_training_validation_schema";

const trainModel = AsyncHandler.handle(async (req, res) => {
  const user = req.user;
  const { images, name } = modelTrainingSchema.parse(req.body);

  if (user.credit < AppConstants.modelTrainingCredit) {
    throw errorResponse.Api403Error({
      errorDescription: "You don`t have sufficient credit to train model",
    });
  }

  // Create a zip file from images
  const imagesBlob = await createTrainingZip({ imageUrls: images });

  // Train model
  const requestId = await handleTrainModel(imagesBlob);

  // Add model info to DB
  const model = await addModel({
    user_id: user.id,
    name,
    request_id: requestId,
    status: EModelStatus.TRAINING,
    training_images: images,
  });

  // Cut credits from user
  await updateUser({
    id: user.id,
    credit: user.credit - AppConstants.modelTrainingCredit,
  });

  res.dataCreateSuccess({ data: { model } });
});

export { trainModel };
