import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import { handleTrainModel } from "@/services/fal_service";
import { addModel } from "@/services/model_service";
import { updateUserCredit } from "@/services/user_service";
import { EModelStatus } from "@/types/model";
import errorResponse from "@/utils/errors/errorResponse";
import { createTrainingZip } from "@/utils/fal_utils";
import { modelTrainingSchema } from "@/utils/validation/model_training_validation_schema";

const trainModel = AsyncHandler.handle(async (req, res) => {
  const user = req.user;
  const { images, name, petName } = modelTrainingSchema.parse(req.body);

  const modelTrainingCharge = AppConstants.modelTrainingCredit;
  const hasEnoughCredit = user.credits >= modelTrainingCharge;

  if (!hasEnoughCredit) {
    throw errorResponse.Api403Error({
      errorDescription: "You don`t have sufficient credits to train model",
    });
  }

  const imagesBlob = await createTrainingZip({ imageUrls: images });
  const requestId = await handleTrainModel(imagesBlob, name);

  const model = await addModel({
    user_id: user.id,
    name,
    pet_name: petName,
    request_id: requestId,
    status: EModelStatus.TRAINING,
    training_images: images,
  });

  await updateUserCredit(user.id, modelTrainingCharge, false);

  res.dataCreateSuccess({ data: { model } });
});

export { trainModel };
