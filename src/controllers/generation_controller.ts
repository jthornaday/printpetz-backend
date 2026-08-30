import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import {
  EditorLook,
  handleEditImageLook,
  handleGenerateImage,
  handleRemoveBackground,
} from "@/services/fal_service";
import { addGeneration } from "@/services/generation_service";
import { getModelById } from "@/services/model_service";
import { getStyleById } from "@/services/style_service";
import { updateUserCredit } from "@/services/user_service";
import { EGenerationStatus } from "@/types/generation";
import errorResponse from "@/utils/errors/errorResponse";
import { generateIdentityPrompt } from "@/utils/fal_utils";
import { generateImageSchema } from "@/utils/validation/generation_validation_schema";

const getGenerationSubject = (
  basePrompt: string,
  styleName: string,
  modelName: string,
  imageIndex: number,
) => {
  const triggerWord = `TOK ${modelName}`;
  const normalizedStyle = styleName.trim().toLowerCase();

  // Baseball needs mutually exclusive equipment/action families. The database
  // prompt historically requested both a bat and a glove, which encourages
  // fused anatomy and mixed-role poses. Keep each generated image coherent.
  if (normalizedStyle.includes("baseball")) {
    const isBatting = imageIndex % 2 === 0;

    if (isBatting) {
      return `Cute ${triggerWord} as an upright anthropomorphic baseball batter, standing on hind legs in a clean conventional batter stance, wearing a full baseball uniform and cap, both animal forepaws making clear contact with exactly one wooden baseball bat, no fielding glove anywhere in the image, epic ballpark background, dramatic lighting, ultra detailed 8K`;
    }

    return `Cute ${triggerWord} as an upright anthropomorphic baseball fielder, standing on hind legs in a clean athletic fielding stance, wearing a full baseball uniform and cap, exactly one baseball glove naturally fitted over one animal forepaw, no baseball bat anywhere in the image, epic ballpark background, dramatic lighting, ultra detailed 8K`;
  }

  return basePrompt.replaceAll("[TRIGGER_WORD]", triggerWord);
};

const createImage = AsyncHandler.handle(async (req, res) => {
  const user = req.user;
  const { numberOfImages, styleId, modelId, cutenessLevel } = generateImageSchema.parse(
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
  const generations = await Promise.all(
    Array.from({ length: numberOfImages }).map(async (_, imageIndex) => {
      const subject = getGenerationSubject(
        style.base_prompt,
        style.name,
        model.name,
        imageIndex,
      );
      const prompt = generateIdentityPrompt(
        subject,
        cutenessLevel,
        model.name,
        style.name,
      );
      const requestId = await handleGenerateImage(
        prompt,
        model.model_path,
        style.name,
      );

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

  await updateUserCredit(user.id, generationCharge, false);

  res.dataCreateSuccess({ data: { generations } });
});

const editLook = AsyncHandler.handle(async (req, res) => {
  const { imageUrl, look } = req.body ?? {};
  const validLooks: EditorLook[] = ["natural", "mascot", "cartoon"];

  if (!imageUrl || typeof imageUrl !== "string") {
    throw errorResponse.Api400Error({
      errorDescription: "A valid image URL is required",
    });
  }

  if (!validLooks.includes(look as EditorLook)) {
    throw errorResponse.Api400Error({
      errorDescription: "Look must be natural, mascot, or cartoon",
    });
  }

  // Editor look changes intentionally do not deduct user credits.
  const editedImageUrl = await handleEditImageLook(imageUrl, look as EditorLook);
  res.dataCreateSuccess({ data: { imageUrl: editedImageUrl } });
});

const removeBackground = AsyncHandler.handle(async (req, res) => {
  const { imageUrl } = req.body ?? {};

  if (!imageUrl || typeof imageUrl !== "string") {
    throw errorResponse.Api400Error({
      errorDescription: "A valid image URL is required",
    });
  }

  const imageUrlWithoutBackground = await handleRemoveBackground(imageUrl);
  res.dataCreateSuccess({ data: { imageUrl: imageUrlWithoutBackground } });
});

export { createImage, editLook, removeBackground };
