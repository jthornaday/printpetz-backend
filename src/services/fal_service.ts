import { fal } from "@fal-ai/client";

import AppConstants from "@/constants/app_constants";
import { getPoseReference } from "@/utils/pose_references";
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

export const handleGenerateImage = async (
  prompt: string,
  path: string,
  styleName?: string,
) => {
  try {
    const isFluxModel = path.includes("/flux/");
    const poseReference = isFluxModel ? getPoseReference(styleName) : undefined;
    const endpoint = poseReference
      ? "fal-ai/flux-general"
      : isFluxModel
        ? "fal-ai/flux-lora"
        : "fal-ai/qwen-image";
    const roleNegativePrompt = getRoleNegativePrompt(styleName);
    const baseNegativePrompt =
      "blurry, low resolution, low quality, watermark, logo, unintended text, cropped face, out of frame, distorted face, deformed anatomy, duplicate animal, multiple pets, extra limbs, extra ears, extra eyes, giant eyes, oversized cartoon eyes, extreme chibi, toy-like anatomy, photorealistic candid snapshot, spectators, crowd, unrelated people, couch, blanket, furniture, source photo background, floating object, unsupported prop, intersecting prop, duplicated prop, broken prop, missing uniform";
    const generationPrompt = poseReference
      ? `${prompt} ${poseReference.guidance}`
      : prompt;

    const result = await fal.queue.submit(endpoint, {
      input: {
        prompt: generationPrompt,
        loras: [{ path, scale: isFluxModel ? 0.95 : 1.0 }],
        num_images: 1,
        num_inference_steps: isFluxModel ? 24 : 32,
        guidance_scale: isFluxModel ? 4.0 : 2.5,
        ...(isFluxModel && !poseReference ? { acceleration: "regular" as const } : {}),
        ...(poseReference
          ? {
              reference_image_url: poseReference.url,
              reference_strength: poseReference.strength,
              reference_start: 0,
              reference_end: 0.85,
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

export type EditorLook = "natural" | "mascot" | "cartoon";

const getEditorLookPrompt = (look: Exclude<EditorLook, "natural">) => {
  const identityLock =
    "This is a surgical style edit of the exact same individual pet in the source image. The output MUST depict the identical pet, not a similar pet and not a different dog. Preserve the pet's exact breed appearance, skull and head shape, muzzle length and width, nose shape and color, eye shape, eye color, ear shape and position, coat colors, coat pattern, every distinctive facial marking, body proportions, pose, paw positions, expression, wardrobe, role, background, camera framing, and every existing object position. Do not change the pet's identity or anatomy. Do not replace, redraw, reinterpret, or beautify the face. Do not add or remove markings. Do not change the pose or equipment. Do not add human hands, fingers, extra limbs, floating objects, duplicated equipment, logos, or text. Change ONLY the requested rendering style while treating the pet identity, geometry, scene, clothing, and props as locked pixels whenever possible.";

  if (look === "cartoon") {
    return `${identityLock} Apply only a restrained polished animated-cartoon surface treatment: simplify fur rendering slightly, use cleaner illustrated edges and modestly more expressive rendering, but keep the face structure, markings, ears, muzzle, eyes, paws, pose, clothing, and scene unchanged. The pet must remain immediately recognizable as the exact same individual.`;
  }

  return `${identityLock} Apply only a restrained professional mascot surface treatment: cleaner merchandise-ready rendering and modest stylization, while keeping the face structure, markings, ears, muzzle, eyes, paws, pose, clothing, and scene unchanged. Do not enlarge the head or eyes. The pet must remain immediately recognizable as the exact same individual.`;
};

export const handleEditImageLook = async (imageUrl: string, look: EditorLook) => {
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
      },
    });

    const images = (result.data as { images?: Array<{ url?: string }> })?.images;
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
