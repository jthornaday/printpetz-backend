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
import { getVariantForImage } from "@/utils/prompt_variants";
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

// PRINTPETZ_FIXED_SEED pins the base seed for every generation, so A/B arms run
// on identical seeds without the caller having to pass one. Images within a
// batch are still offset by index, so a batch of 4 is S, S+1, S+2, S+3 — four
// different images, but the same four in every arm.
//
// The env var deliberately wins over a caller-supplied seed: it is an operator
// override for experiments, and an arm that silently used a different seed
// because the client sent one would be worthless.
// Parsed in one place so the seed and the variant rotation agree about whether
// this run is pinned. A half-pinned run — fixed seed, rotating variants — would
// look reproducible and quietly not be.
const readFixedSeed = () => {
  const raw = process.env.PRINTPETZ_FIXED_SEED;
  if (raw === undefined || raw.trim() === "") return undefined;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= SEED_RANGE) {
    // eslint-disable-next-line no-console
    console.warn(
      `[generation-config] PRINTPETZ_FIXED_SEED="${raw}" is not an integer in 0..${SEED_RANGE - 1}. Ignoring it.`,
    );
    return undefined;
  }

  return parsed;
};

const getBaseSeed = (requestSeed: number | undefined) => {
  const fixedSeed = readFixedSeed();
  if (fixedSeed === undefined) return requestSeed;

  if (requestSeed !== undefined && requestSeed !== fixedSeed) {
    // eslint-disable-next-line no-console
    console.warn(
      `[generation-config] PRINTPETZ_FIXED_SEED=${fixedSeed} is overriding the caller-supplied seed ${requestSeed}.`,
    );
  }

  return fixedSeed;
};

// Which variant image 0 of a batch starts on. Rotating on group_id means a
// customer who generates the same theme twice gets different framings the
// second time, instead of the same first-four every batch — with only four
// images per batch and five variants, a fixed start would leave the fifth
// permanently unused.
//
// A pinned seed switches the rotation off: an A/B arm has to be reproducible,
// and an offset keyed to wall-clock time would make every run a different
// experiment.
const getVariantOffset = (groupId: number) =>
  readFixedSeed() === undefined ? groupId : 0;

// Garments are described affirmatively rather than by exclusion. flux-lora
// drops negative_prompt entirely, and FLUX renders whatever nouns appear in the
// prompt regardless of negation — "no team logo" puts "team logo" in front of
// the model. So the cap is "plain solid-colour with a blank front panel", and
// the trousers are stated as present and covering the legs rather than the fur
// being talked out of existence.
const getGenerationSubject = (
  basePrompt: string,
  styleName: string,
  triggerWord: string,
  imageIndex: number,
  variants: unknown,
  variantOffset: number,
) => {
  const normalizedStyle = styleName.trim().toLowerCase();

  if (normalizedStyle.includes("baseball")) {
    const isBatting = imageIndex % 2 === 0;

    if (isBatting) {
      return `Cute ${triggerWord} as an upright anthropomorphic baseball batter on hind legs in a clean conventional batter stance, wearing a plain white baseball jersey, white fabric baseball trousers covering both legs to the ankle, a belt at the waist, and a plain solid-colour baseball cap with a blank front panel. Fur shows only on the head, forepaws and tail. Both animal forepaws grip exactly one wooden baseball bat, with no fielding glove anywhere in the image. Epic ballpark background, dramatic lighting, ultra detailed 8K`;
    }

    return `Cute ${triggerWord} as an upright anthropomorphic baseball fielder on hind legs in a clean athletic fielding stance, wearing a plain white baseball jersey, white fabric baseball trousers covering both legs to the ankle, a belt at the waist, and a plain solid-colour baseball cap with a blank front panel. Fur shows only on the head, forepaws and tail. Exactly one leather baseball glove is fitted over one animal forepaw, with no baseball bat anywhere in the image. Epic ballpark background, dramatic lighting, ultra detailed 8K`;
  }

  const subject = basePrompt.replaceAll("[TRIGGER_WORD]", triggerWord);
  const variant = getVariantForImage(
    variants,
    variantOffset + imageIndex,
    styleName,
  );
  if (!variant) return subject;

  // The variant lands as its own sentence after the theme block, so the
  // background and quality tail stay where the theme put them. Capitalised
  // because the base prompt ends in a full stop.
  const subjectWithStop = subject.trim().replace(/\.?$/, ".");
  return `${subjectWithStop} ${variant[0].toUpperCase()}${variant.slice(1)}`;
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
  const petDescription = model.pet_description?.trim() || undefined;
  const triggerWord = getModelTriggerWord(model.model_path, model.name);
  const baseSeed = getBaseSeed(seed);
  const group_id = Date.now();
  const variantOffset = getVariantOffset(group_id);
  const generations = await Promise.all(
    Array.from({ length: numberOfImages }).map(async (_, imageIndex) => {
      const subject = getGenerationSubject(
        style.base_prompt,
        style.name,
        triggerWord,
        imageIndex,
        style.variants,
        variantOffset,
      );
      const prompt = generateIdentityPrompt(
        subject,
        cutenessLevel,
        petName,
        style.name,
        petDescription,
      );
      const imageSeed = getImageSeed(baseSeed, imageIndex);
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
