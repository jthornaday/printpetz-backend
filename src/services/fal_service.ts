import { fal } from "@fal-ai/client";

import AppConstants from "@/constants/app_constants";
import { warnIfPromptOverBudget } from "@/utils/fal_utils";
import { isFluxModelPath } from "@/utils/model_utils";
import { getPoseReference, PoseReference } from "@/utils/pose_references";
import { getRoleNegativePrompt } from "@/utils/role_blueprints";

import { addErrorLog } from "./error_logs_service";

fal.config({ credentials: AppConstants.falApiKey });

export const handleTrainModel = async (datasetUrl: Blob, name: string) => {
  try {
    const input = {
      images_data_url: datasetUrl,
      trigger_word: "TOK",
      create_masks: true,
      is_style: false,
      steps: 400,
    };

    const result = await fal.queue.submit("fal-ai/flux-lora-fast-training", {
      input,
      webhookUrl: `${AppConstants.serverBaseUrl}/webhook/fal/training-result`,
    });

    console.log({ result });

    return result.request_id;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({}),
      error: JSON.stringify({ error }),
      type: "MODEL_TRAIN_REQUEST",
    });
    throw error;
  }
};

// A/B knobs for the reference-guidance experiment. Read at call time rather
// than at module load so changing an EB environment property takes effect on
// restart without a code deploy.
//
// PRINTPETZ_REF_STRENGTH  defaults to the per-style value in pose_references.ts
//                         (0.72 for baseball). Setting it to 0 drops reference
//                         guidance entirely — see resolveReferenceConfig.
// PRINTPETZ_REF_START     defaults to 0
// PRINTPETZ_REF_END       defaults to 0.85
// PRINTPETZ_LORA_SCALE    defaults to 0.95 on FLUX, 1.0 on qwen — see
//                         resolveLoraScale below
const readFloatEnv = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[reference-config] ${key}="${raw}" is not a number. Falling back to ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
};

// Returns undefined when reference guidance should be switched off entirely,
// which also drops the request back to the flux-lora endpoint. That is the
// "reference off" arm: strength 0 on flux-general would still route through
// the reference code path and rely on fal treating 0 as a no-op.
const resolveReferenceConfig = (poseReference: PoseReference | undefined) => {
  if (!poseReference) return undefined;

  const strength = readFloatEnv(
    "PRINTPETZ_REF_STRENGTH",
    poseReference.strength,
  );
  if (strength <= 0) return undefined;

  return {
    url: poseReference.url,
    guidance: poseReference.guidance,
    strength,
    start: readFloatEnv("PRINTPETZ_REF_START", 0),
    end: readFloatEnv("PRINTPETZ_REF_END", 0.85),
  };
};

// fal documents loras[].scale as "Application strength (0-2)" with a default of
// 1, and its own best-practice note puts the usual working band at 0.5-1.5. So
// values above 1.0 are legal, and they are the point of this knob.
//
// The reason it exists: themes with a strong human-costume prior — founding
// father, warrior, archer — render a human instead of the pet, or give it human
// hands and legs. Themes FLUX has seen on dogs (santa, baseball) come out
// clean. That pattern is the base model's prior beating the LoRA, which is a
// weighting problem rather than a wording one, and no amount of prompt editing
// fixes it.
const LORA_SCALE_MIN = 0;
const LORA_SCALE_MAX = 2;

// 0.95 is what every FLUX generation has used to date; qwen models have always
// used 1.0. Both are preserved as defaults so an unset env var changes nothing.
const DEFAULT_FLUX_LORA_SCALE = 0.95;
const DEFAULT_QWEN_LORA_SCALE = 1.0;

// One env var covers both endpoints deliberately: an A/B arm that silently
// applied to FLUX but not qwen would be reporting on a mixed population.
const resolveLoraScale = (isFluxModel: boolean) => {
  const fallback = isFluxModel
    ? DEFAULT_FLUX_LORA_SCALE
    : DEFAULT_QWEN_LORA_SCALE;
  const requested = readFloatEnv("PRINTPETZ_LORA_SCALE", fallback);

  if (requested < LORA_SCALE_MIN || requested > LORA_SCALE_MAX) {
    const clamped = Math.min(
      Math.max(requested, LORA_SCALE_MIN),
      LORA_SCALE_MAX,
    );
    // eslint-disable-next-line no-console
    console.warn(
      `[generation-config] PRINTPETZ_LORA_SCALE=${requested} is outside fal's documented ${LORA_SCALE_MIN}-${LORA_SCALE_MAX} range for loras[].scale. Clamping to ${clamped}.`,
    );
    return clamped;
  }

  return requested;
};

/**
 * Everything that decides what fal is asked for, with nothing about HOW the
 * request is sent.
 *
 * Extracted so the bakeoff can run the FAL arm synchronously through
 * fal.subscribe while production keeps using the queue and its webhook. A
 * bakeoff arm that built its own input would be measuring a different FAL than
 * the one customers get, which would make the comparison worthless -- the
 * exact failure the 13 Sept log calls out as "a test against un-deployed code
 * is worthless".
 */
export const buildFalGenerationInput = (
  prompt: string,
  path: string,
  seed: number,
  styleName?: string,
) => {
  const isFluxModel = isFluxModelPath(path);
  const poseReference = isFluxModel ? getPoseReference(styleName) : undefined;
  const reference = resolveReferenceConfig(poseReference);
  const endpoint = reference
    ? "fal-ai/flux-general"
    : isFluxModel
      ? "fal-ai/flux-lora"
      : "fal-ai/qwen-image";
  const loraScale = resolveLoraScale(isFluxModel);
  const roleNegativePrompt = getRoleNegativePrompt(styleName);
  const baseNegativePrompt =
    "blurry, low resolution, low quality, watermark, logo, unintended text, cropped face, out of frame, distorted face, deformed anatomy, duplicate animal, multiple pets, extra limbs, extra ears, extra eyes, giant eyes, oversized cartoon eyes, extreme chibi, toy-like anatomy, photorealistic candid snapshot, spectators, crowd, unrelated people, couch, blanket, furniture, source photo background, floating object, unsupported prop, intersecting prop, duplicated prop, broken prop, missing uniform";
  const generationPrompt = reference
    ? `${prompt} ${reference.guidance}`
    : prompt;

  // generateIdentityPrompt already checks its own output, but the pose
  // guidance is appended here — so the string that actually goes to fal is
  // only measurable at this point.
  const estimatedPromptTokens = warnIfPromptOverBudget(generationPrompt, {
    styleName,
  });

  // One line per generation, carrying everything an A/B arm needs to be
  // reconstructed: which endpoint ran, whether a reference was used at all
  // and which one, the reference values in force, the seed, and the prompt
  // size. `referenceUsed: false` means this generation had no reference
  // image — either the style has no pool, the pool env var is unset, or
  // PRINTPETZ_REF_STRENGTH switched it off.
  // eslint-disable-next-line no-console
  console.log(
    "[generation-config]",
    JSON.stringify({
      endpoint,
      styleName: styleName ?? null,
      seed,
      estimatedPromptTokens,
      loraScale,
      referenceUsed: Boolean(reference),
      referencePoolConfigured: Boolean(poseReference),
      referenceImageUrl: reference?.url ?? null,
      referenceStrength: reference?.strength ?? null,
      referenceStart: reference?.start ?? null,
      referenceEnd: reference?.end ?? null,
    }),
  );

  return {
    endpoint,
    input: {
      prompt: generationPrompt,
      seed,
      loras: [{ path, scale: loraScale }],
      num_images: 1,
      num_inference_steps: isFluxModel ? 24 : 32,
      guidance_scale: isFluxModel ? 4.0 : 2.5,
      ...(isFluxModel && !reference
        ? { acceleration: "regular" as const }
        : {}),
      ...(reference
        ? {
            reference_image_url: reference.url,
            reference_strength: reference.strength,
            reference_start: reference.start,
            reference_end: reference.end,
          }
        : {}),
      output_format: "jpeg",
      image_size: {
        width: 820,
        height: 1024,
      },
      negative_prompt: roleNegativePrompt
        ? `${baseNegativePrompt}, ${roleNegativePrompt}`
        : baseNegativePrompt,
    },
  };
};

export const handleGenerateImage = async (
  prompt: string,
  path: string,
  seed: number,
  styleName?: string,
) => {
  try {
    const { endpoint, input } = buildFalGenerationInput(
      prompt,
      path,
      seed,
      styleName,
    );

    const result = await fal.queue.submit(endpoint, {
      input,
      webhookUrl: `${AppConstants.serverBaseUrl}/webhook/fal/generation-result`,
    });

    return result.request_id;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ prompt, path, styleName }),
      error: JSON.stringify({ error }),
      type: "IMAGE_GENERATION",
    });
    throw error;
  }
};

/**
 * The same request, awaited instead of queued. Bakeoff only -- production must
 * stay on the queue so a slow generation never holds a request thread.
 */
export const generateFalImageSync = async (
  prompt: string,
  path: string,
  seed: number,
  styleName?: string,
) => {
  const { endpoint, input } = buildFalGenerationInput(
    prompt,
    path,
    seed,
    styleName,
  );
  const startedAt = Date.now();

  const result = await fal.subscribe(endpoint, { input });
  const images = (result.data as { images?: Array<{ url?: string }> })?.images;
  const url = images?.[0]?.url;

  if (!url) throw new Error("fal returned no image");

  return { url, latencyMs: Date.now() - startedAt };
};

export type EditorLook = "natural" | "mascot" | "cartoon";

const getEditorLookPrompt = (look: Exclude<EditorLook, "natural">) => {
  const identityLock =
    "This is a surgical style edit of the exact same individual pet in the source image. The output MUST depict the identical pet, not a similar pet and not a different dog. Preserve the pet's exact breed appearance, skull and head shape, muzzle length and width, nose shape and color, eye shape, eye color, ear shape and position, coat colors, coat pattern, every distinctive facial marking, body proportions, pose, paw positions, expression, wardrobe, role, background, camera framing, and every existing object position. Do not change the pet's identity or anatomy. Do not replace, redraw, reinterpret, or beautify the face. Do not add or remove markings. Do not change the pose or equipment. Do not add human hands, fingers, extra limbs, floating objects, duplicated equipment, logos, or text. Change ONLY the requested rendering style while treating the pet identity, geometry, scene, clothing, and props as locked pixels whenever possible.";

  if (look === "cartoon") {
    return `${identityLock} Apply only a restrained polished animated-cartoon surface treatment: simplify fur rendering slightly, use cleaner illustrated edges and modestly more expressive rendering, but keep the face structure, markings, ears, muzzle, eyes, paws, pose, clothing, and scene unchanged. The pet must remain immediately recognizable as the exact same individual.`;
  }

  return `${identityLock} Apply only a restrained professional mascot surface treatment: cleaner merchandise-ready rendering and modest stylization, while keeping the face structure, markings, ears, muzzle, eyes, paws, pose, clothing, and scene unchanged. Do not enlarge the head or eyes. The pet must remain immediately recognizable as the exact same individual.`;
};

export const handleEditImageLook = async (
  imageUrl: string,
  look: EditorLook,
  seed?: number,
) => {
  // Natural is the original generation. Returning it directly guarantees that
  // choosing Natural can never mutate the pet into a lookalike.
  if (look === "natural") return imageUrl;

  try {
    const result = await fal.subscribe("fal-ai/flux-pro/kontext", {
      input: {
        image_url: imageUrl,
        prompt: getEditorLookPrompt(look),
        guidance_scale: 2.0,
        num_images: 1,
        output_format: "jpeg" as const,
        enhance_prompt: false,
        ...(seed !== undefined ? { seed } : {}),
      },
    });

    const images = (result.data as { images?: Array<{ url?: string }> })
      ?.images;
    const editedUrl = images?.[0]?.url;
    if (!editedUrl) {
      throw new Error("Image editor did not return an image");
    }

    return editedUrl;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ imageUrl, look }),
      error: JSON.stringify({ error }),
      type: "IMAGE_EDITOR_LOOK",
    });
    throw error;
  }
};

export const handleRemoveBackground = async (imageUrl: string) => {
  try {
    const result = await fal.subscribe("fal-ai/imageutils/rembg", {
      input: {
        image_url: imageUrl,
        crop_to_bbox: false,
      },
    });

    const image = (result.data as { image?: { url?: string } })?.image;
    if (!image?.url) {
      throw new Error("Background removal did not return an image");
    }

    return image.url;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ imageUrl }),
      error: JSON.stringify({ error }),
      type: "BACKGROUND_REMOVAL",
    });
    throw error;
  }
};
