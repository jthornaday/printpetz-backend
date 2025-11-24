import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import { handleGenerateImage } from "@/services/fal_service";
import { addGeneration } from "@/services/generation_service";
import { getModelById } from "@/services/model_service";
import { getStyleById } from "@/services/style_service";
import { updateUser } from "@/services/user_service";
import { EGenerationStatus } from "@/types/generation";
import { getRandomItemFromList } from "@/utils/app_utils";
import errorResponse from "@/utils/errors/errorResponse";
import { generateImageSchema } from "@/utils/validation/generation_validation_schema";

const createImage = AsyncHandler.handle(async (req, res) => {
  const user = req.user;
  const { numberOfImages, styleId, modelId } = generateImageSchema.parse(
    req.body,
  );

  if (user.credit < AppConstants.generationChargePerImage * numberOfImages) {
    throw errorResponse.Api403Error({
      errorDescription: "You don`t have sufficient credit to generate image",
    });
  }

  const [model, style] = await Promise.all([
    getModelById(modelId),
    getStyleById(styleId),
  ]);
  if (!model || !style) {
    throw errorResponse.Api404Error({
      errorDescription: `${model ? "Style" : "Model"} not found`,
    });
  }

  const group_id = Date.now();
  const generations = await Promise.all(
    Array.from({ length: numberOfImages }).map(async (_, i) => {
      // const prompt = getRandomItemFromList(style.prompts);

      const prompt =
        "TOK as a brave army officer standing confidently on a battlefield, wearing a detailed military uniform with realistic textures, badges and gear. Dusty lighting, flying embers in the air, dramatic war-zone atmosphere with smoke and depth. Strong heroic pose, intense expression, cinematic depth of field, ultra-sharp focus, 8K hyper-realistic war photography style, masterpiece quality.";

      const requestId = await handleGenerateImage(prompt, model.model_path);

      return addGeneration({
        group_id,
        request_id: requestId.toString(),
        status: EGenerationStatus.GENERATING,
        model_id: modelId,
        style_id: styleId,
        user_id: user.id,
        prompt,
      });
    }),
  );

  // Cut credits from user
  await updateUser({
    id: user.id,
    credit:
      user.credit - AppConstants.generationChargePerImage * numberOfImages,
  });

  res.dataCreateSuccess({ data: { generations } });
});

export { createImage };
