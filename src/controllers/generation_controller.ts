import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import { handleGenerateImage } from "@/services/fal_service";
import { addGeneration } from "@/services/generation_service";
import { getModelById } from "@/services/model_service";
import { getStyleById } from "@/services/style_service";
import { updateUserCredit } from "@/services/user_service";
import { EGenerationStatus } from "@/types/generation";
import errorResponse from "@/utils/errors/errorResponse";
import { generateIdentityPrompt } from "@/utils/fal_utils";
import { generateImageSchema } from "@/utils/validation/generation_validation_schema";

const createImage = AsyncHandler.handle(async (req, res) => {
  const user = req.user;
  const { numberOfImages, styleId, modelId } = generateImageSchema.parse(
    req.body,
  );

  const generationCharge = AppConstants.imageGenerationCredit * numberOfImages;
  const hasEnoughCredit = user.credits >= generationCharge;

  if (!hasEnoughCredit) {
    throw errorResponse.Api403Error({
      errorDescription: "You don`t have sufficient credits to generate image",
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
  const subject = style.base_prompt.replaceAll(
    "[TRIGGER_WORD]",
    `TOK ${model.name}`,
  );
  const generations = await Promise.all(
    Array.from({ length: numberOfImages }).map(async () => {
      const prompt = generateIdentityPrompt(subject);
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
  await updateUserCredit(user.id, generationCharge, false);

  res.dataCreateSuccess({ data: { generations } });
});

export { createImage };
