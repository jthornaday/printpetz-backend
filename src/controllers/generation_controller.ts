import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import {
  EditorLook,
  handleEditImageLook,
  handleGenerateImage,
  handleRemoveBackground,
} from "@/services/fal_service";
import {
  addGeneration,
  getGenerationById,
} from "@/services/generation_service";
import { getFileBufferFromUrl } from "@/services/file_service";
import { getModelById } from "@/services/model_service";
import { getStyleById } from "@/services/style_service";
import { updateUserCredit } from "@/services/user_service";
import { EGenerationStatus } from "@/types/generation";
import errorResponse from "@/utils/errors/errorResponse";
import { generateIdentityPrompt } from "@/utils/fal_utils";
import { getModelTriggerWord } from "@/utils/model_utils";
import { generateImageSchema } from "@/utils/validation/generation_validation_schema";

// fal accepts a 32-bit unsigned seed.
const SEED_RANGE = 4294967296;

// A batch shares one base seed so a caller can reproduce the whole batch from a
// single number, but each image is offset so the images differ from each other.
// With no caller seed, each image draws independently.
const getImageSeed = (baseSeed: number | undefined, imageIndex: number) =>
  baseSeed === undefined
    ? Math.floor(Math.random() * SEED_RANGE)
    : (baseSeed + imageIndex) % SEED_RANGE;

const getGenerationSubject = (
  basePrompt: string,
  styleName: string,
  triggerWord: string,
  imageIndex: number,
) => {
  const normalizedStyle = styleName.trim().toLowerCase();

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
  const { numberOfImages, styleId, modelId, cutenessLevel, seed } =
    generateImageSchema.parse(req.body);

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

  const petName = model.pet_name?.trim() || model.name;
  const triggerWord = getModelTriggerWord(model.model_path, model.name);
  const group_id = Date.now();
  const generations = await Promise.all(
    Array.from({ length: numberOfImages }).map(async (_, imageIndex) => {
      const subject = getGenerationSubject(
        style.base_prompt,
        style.name,
        triggerWord,
        imageIndex,
      );
      const prompt = generateIdentityPrompt(
        subject,
        cutenessLevel,
        petName,
        style.name,
      );
      const imageSeed = getImageSeed(seed, imageIndex);
      const requestId = await handleGenerateImage(
        prompt,
        model.model_path,
        imageSeed,
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
        seed: imageSeed,
      });
    }),
  );

  await updateUserCredit(user.id, generationCharge, false);

  res.dataCreateSuccess({ data: { generations } });
});

const downloadImage = AsyncHandler.handle(async (req, res) => {
  const generationId = Number(req.params.id);
  if (!Number.isInteger(generationId) || generationId <= 0) {
    throw errorResponse.Api400Error({ errorDescription: "Invalid generation id" });
  }

  const generation = await getGenerationById(generationId);
  if (!generation || generation.user_id !== req.user.id || !generation.image) {
    throw errorResponse.Api404Error({ errorDescription: "Image not found" });
  }

  const imageUrl = generation.image;
  const pathname = new URL(imageUrl).pathname;
  const rawExtension = pathname.split(".").pop()?.toLowerCase();
  const extension = rawExtension && ["png", "jpg", "jpeg", "webp", "gif"].includes(rawExtension)
    ? rawExtension === "jpeg" ? "jpg" : rawExtension
    : "png";

  const contentTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };

  const buffer = await getFileBufferFromUrl(imageUrl, contentTypes[extension]);
  const filename = `printpetz_${generation.id}_${Date.now()}.${extension}`;

  res.setHeader("Content-Type", contentTypes[extension] ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length.toString());
  res.send(buffer);
});

const editLook = AsyncHandler.handle(async (req, res) => {
  const { imageUrl, look, seed } = req.body ?? {};
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

  if (
    seed !== undefined &&
    (!Number.isInteger(seed) || seed < 0 || seed >= SEED_RANGE)
  ) {
    throw errorResponse.Api400Error({
      errorDescription: `Seed must be an integer between 0 and ${SEED_RANGE - 1}`,
    });
  }

  // A restyle is not persisted as a generation row, so there is nowhere to
  // record this seed. It only makes a restyle repeatable for a caller who
  // supplies one.
  const editedImageUrl = await handleEditImageLook(
    imageUrl,
    look as EditorLook,
    seed,
  );
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

export { createImage, downloadImage, editLook, removeBackground };
