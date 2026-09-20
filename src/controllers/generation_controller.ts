import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import {
  EditorLook,
  handleEditImageLook,
  handleRemoveBackground,
} from "@/services/fal_service";
import {
  addGeneration,
  countUnfinishedGenerations,
  getGenerationById,
  providerColumns,
  uploadGenerationImageBuffer,
} from "@/services/generation_service";
import { getImageProvider } from "@/services/providers";
import { logOpenAIFailure } from "@/services/providers/openai_provider";
import { getFileBufferFromUrl } from "@/services/file_service";
import { getModelById } from "@/services/model_service";
import { getStyleById } from "@/services/style_service";
import { updateUserCredit } from "@/services/user_service";
import { EGenerationStatus } from "@/types/generation";
import { ImageGenerationFailure } from "@/types/image_provider";
import errorResponse from "@/utils/errors/errorResponse";
import { generateIdentityPrompt, GenerationLane } from "@/utils/fal_utils";
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
// prompt regardless of negation, so the wardrobe is stated as present.
//
// Three things here come straight off the 13 Sept batches rather than theory:
//
// Cap logos. "Plain front panel" left the panel empty and the model filled it —
// Max produced a Yankees NY on three of four caps. In every image across both
// batches where the pet's NAME was on the cap panel, no logo appeared. An empty
// slot gets filled; the fix is to fill it deliberately, not to ask for blank.
//
// Chaps. "Covering both legs to the ankle" rendered as a front panel with the
// hindquarters and rear legs bare behind it, three of four. The seat and hips
// have to be named or they do not get covered.
//
// Bobble-heads. "Cute" opens every prompt and on FLUX it pulls toward
// big-head/big-eye mascot proportions even in Natural. Dropped here only; the
// same word opens all 70 DB base_prompts and those are a separate change.
const getGenerationSubject = (
  basePrompt: string,
  styleName: string,
  triggerWord: string,
  imageIndex: number,
  variants: unknown,
  variantOffset: number,
  petName: string,
) => {
  const normalizedStyle = styleName.trim().toLowerCase();

  if (normalizedStyle.includes("baseball")) {
    const isBatting = imageIndex % 2 === 0;

    const capName = petName.toUpperCase();

    if (isBatting) {
      return `${triggerWord} as an upright anthropomorphic baseball batter on hind legs in a clean conventional batter stance, wearing a plain white baseball jersey, white fabric baseball trousers fully covering the seat, hips and both hind legs down to the ankle, a belt at the waist, and a plain baseball cap whose front panel reads "${capName}" in block letters. Fur shows only on the head, forepaws and tail. A leather fielding glove is worn over one forepaw; the other forepaw grips the bat handle. Epic ballpark background, dramatic lighting, ultra detailed 8K`;
    }

    return `${triggerWord} as an upright anthropomorphic baseball fielder on hind legs in a clean athletic fielding stance, wearing a plain white baseball jersey, white fabric baseball trousers fully covering the seat, hips and both hind legs down to the ankle, a belt at the waist, and a plain baseball cap whose front panel reads "${capName}" in block letters. Fur shows only on the head, forepaws and tail. A leather fielding glove is worn over one forepaw, the other forepaw resting on the glove. Epic ballpark background, dramatic lighting, ultra detailed 8K`;
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

  const provider = getImageProvider();
  const lane: GenerationLane =
    provider.name === "openai" ? "reference" : "lora";

  // The LoRA trigger word is a FLUX artefact: it names the weights the pet was
  // trained into. A reference-image provider has no such weights, and passing
  // "TOK" to one just puts the literal string in the picture -- which FLUX
  // itself did on two of four Wizard caps on 13 Sept. The reference lane names
  // the subject in plain English instead.
  const triggerWord =
    lane === "reference"
      ? "the pet"
      : getModelTriggerWord(model.model_path, model.name);

  const baseSeed = getBaseSeed(seed);
  const group_id = Date.now();
  const variantOffset = getVariantOffset(group_id);

  // Two shapes, because the providers are two shapes.
  //
  // FAL is queued: submitting returns a request id in milliseconds and a
  // webhook finishes the row, so submitting inline costs nothing.
  //
  // OpenAI is synchronous and took 21-84 seconds per image in the bakeoff. The
  // first live batch on 16 Sept ran four of those concurrently against a
  // tier-1 limit of five images a minute, held the HTTP connection for
  // minutes, and charged for images the customer never saw -- Node does not
  // abort a handler when the client hangs up, and the frontend only refetches
  // after the request resolves. So the OpenAI lane inserts the rows and
  // returns; generation_worker drains them, paced.
  const isQueuedLane = lane === "reference";

  const buildPrompt = (imageIndex: number) => {
    const subject = getGenerationSubject(
      style.base_prompt,
      style.name,
      triggerWord,
      imageIndex,
      style.variants,
      variantOffset,
      petName,
    );
    return generateIdentityPrompt(
      subject,
      cutenessLevel,
      petName,
      style.name,
      petDescription,
      lane,
    );
  };

  if (isQueuedLane) {
    // One unfinished batch at a time. The Create page resets its image count
    // to the default of 2 on refresh, so refresh-and-retry during a slow batch
    // is a realistic path to paying twice -- which is what turned a four-image
    // request into a twelve-credit charge on 16 Sept.
    const unfinished = await countUnfinishedGenerations(user.id);
    if (unfinished > 0) {
      throw errorResponse.Api400Error({
        errorDescription: `You already have ${unfinished} image${unfinished === 1 ? "" : "s"} being generated. They'll appear here shortly — no need to start another batch.`,
      });
    }

    const inserted = await Promise.all(
      Array.from({ length: numberOfImages }).map(async (_, imageIndex) =>
        addGeneration({
          group_id,
          model_id: modelId,
          style_id: styleId,
          user_id: user.id,
          prompt: buildPrompt(imageIndex),
          seed: getImageSeed(baseSeed, imageIndex),
          // provider_model is unknown until the worker runs, and it fills it in.
          ...providerColumns(provider.name),
          // Inserted as GENERATING, not PENDING: the frontend already polls
          // GENERATING for the FAL lane, and PENDING is a status the deployed
          // frontend does not recognise. request_id stays null -- that null is
          // what the worker claims against, atomically.
          status: EGenerationStatus.GENERATING,
          request_id: null,
        }),
      ),
    );

    // addGeneration returns null on a failed insert rather than throwing. A row
    // that did not save is nothing the worker will run and nothing History will
    // show, so it is neither charged for nor returned to the frontend.
    const generations = inserted.filter(
      (generation): generation is NonNullable<typeof generation> =>
        generation !== null,
    );
    if (generations.length === 0) {
      throw errorResponse.Api500Error({
        errorDescription:
          "We couldn't start your images and you haven't been charged. Please try again.",
      });
    }

    // Charged up front and refunded on failure, exactly as the FAL lane
    // already does from its webhook. One billing model, one refund path, and
    // no way to queue work you cannot afford.
    await updateUserCredit(
      user.id,
      AppConstants.imageGenerationCredit * generations.length,
      false,
    );

    res.dataCreateSuccess({ data: { generations } });
    return;
  }

  const results = await Promise.all(
    Array.from({ length: numberOfImages }).map(async (_, imageIndex) => {
      const prompt = buildPrompt(imageIndex);
      const imageSeed = getImageSeed(baseSeed, imageIndex);

      const common = {
        group_id,
        model_id: modelId,
        style_id: styleId,
        user_id: user.id,
        prompt,
        seed: imageSeed,
      };
      try {
        const result = await provider.generate({
          prompt,
          modelPath: model.model_path,
          referenceImageUrls: model.training_images ?? [],
          petName,
          seed: imageSeed,
          styleName: style.name,
        });

        // The whole point of the union. A queued provider gets a row to finish
        // later via its webhook; a synchronous one already has the bytes, so
        // the row is born complete and nothing ever calls back for it.
        if (result.kind === "queued") {
          const generation = await addGeneration({
            ...common,
            ...providerColumns(result.provider, result.providerModel),
            request_id: result.requestId,
            status: EGenerationStatus.GENERATING,
          });
          // No row means nothing in History and nothing for the webhook to
          // finish, so nothing to charge for.
          return { billable: generation !== null, generation };
        }

        const imageUrl = await uploadGenerationImageBuffer(
          user.id,
          result.image.buffer,
          result.image.contentType,
          result.image.extension,
        );

        if (!imageUrl) {
          throw new ImageGenerationFailure(
            result.provider,
            "provider_error",
            "Generated image could not be stored",
          );
        }

        const generation = await addGeneration({
          ...common,
          ...providerColumns(result.provider, result.providerModel),
          request_id: result.providerMeta.responseId ?? null,
          status: EGenerationStatus.COMPLETED,
          image: imageUrl,
        });
        // The image is in S3, but a customer who cannot see it in History has
        // not received it. The failed insert is in error_logs with its URL, so
        // it can still be recovered by hand.
        return { billable: generation !== null, generation };
      } catch (error) {
        // A failure the customer did not get an image from is a failure the
        // customer does not pay for -- the same rule as any other AI failure.
        // Only synchronous providers reach here; a FAL failure surfaces later
        // through its webhook and is handled there as it always has been.
        const failure =
          error instanceof ImageGenerationFailure
            ? error
            : new ImageGenerationFailure(
                provider.name,
                "provider_error",
                error instanceof Error ? error.message : String(error),
              );

        if (failure.provider === "openai") {
          logOpenAIFailure(failure, {
            styleName: style.name,
            modelId,
            imageIndex,
          });
        }

        const generation = await addGeneration({
          ...common,
          ...providerColumns(failure.provider, provider.name),
          status: EGenerationStatus.ERROR,
          error: { reason: failure.reason, message: failure.message },
        });
        return { billable: false, generation };
      }
    }),
  );

  const generations = results.map((result) => result.generation);
  const billableCount = results.filter((result) => result.billable).length;

  if (billableCount > 0) {
    await updateUserCredit(
      user.id,
      AppConstants.imageGenerationCredit * billableCount,
      false,
    );
  }

  res.dataCreateSuccess({ data: { generations } });
});

const downloadImage = AsyncHandler.handle(async (req, res) => {
  const generationId = Number(req.params.id);
  if (!Number.isInteger(generationId) || generationId <= 0) {
    throw errorResponse.Api400Error({
      errorDescription: "Invalid generation id",
    });
  }

  const generation = await getGenerationById(generationId);
  if (!generation || generation.user_id !== req.user.id || !generation.image) {
    throw errorResponse.Api404Error({ errorDescription: "Image not found" });
  }

  const imageUrl = generation.image;
  const pathname = new URL(imageUrl).pathname;
  const rawExtension = pathname.split(".").pop()?.toLowerCase();
  const extension =
    rawExtension && ["png", "jpg", "jpeg", "webp", "gif"].includes(rawExtension)
      ? rawExtension === "jpeg"
        ? "jpg"
        : rawExtension
      : "png";

  const contentTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };

  const buffer = await getFileBufferFromUrl(imageUrl, contentTypes[extension]);
  const filename = `printpetz_${generation.id}_${Date.now()}.${extension}`;

  res.setHeader(
    "Content-Type",
    contentTypes[extension] ?? "application/octet-stream",
  );
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
