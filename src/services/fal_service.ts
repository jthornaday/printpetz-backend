import { fal } from "@fal-ai/client";

import AppConstants from "@/constants/app_constants";
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
    const endpoint = isFluxModel ? "fal-ai/flux-lora" : "fal-ai/qwen-image";
    const roleNegativePrompt = getRoleNegativePrompt(styleName);
    const baseNegativePrompt =
      "blurry, low resolution, low quality, watermark, logo, unintended text, cropped face, out of frame, distorted face, deformed anatomy, duplicate animal, multiple pets, extra limbs, extra ears, extra eyes, giant eyes, oversized cartoon eyes, extreme chibi, toy-like anatomy, photorealistic candid snapshot, spectators, crowd, unrelated people, couch, blanket, furniture, source photo background, floating object, unsupported prop, intersecting prop, duplicated prop, broken prop, missing uniform";

    const result = await fal.queue.submit(endpoint, {
      input: {
        prompt,
        loras: [{ path, scale: isFluxModel ? 0.95 : 1.0 }],
        num_images: 1,
        num_inference_steps: isFluxModel ? 24 : 32,
        guidance_scale: isFluxModel ? 4.0 : 2.5,
        ...(isFluxModel ? { acceleration: "regular" as const } : {}),
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

const getEditorLookPrompt = (look: EditorLook) => {
  const shared =
    "Edit this existing PrintPetz image only. Preserve the same pet identity, face markings, coat colors, ears, muzzle, pose, outfit, role, composition, background, and existing equipment placement as closely as possible. Do not add extra limbs, human hands, fingers, floating objects, duplicate equipment, logos, or new text.";

  if (look === "natural") {
    return `${shared} Make the pet rendering NATURAL: realistic pet facial proportions, normal eye size, true muzzle and ear shape, realistic fur texture, and real animal paws rather than furry human hands. Keep the same anthropomorphic role and wardrobe.`;
  }

  if (look === "cartoon") {
    return `${shared} Make the pet rendering CARTOON: polished animated illustration, smoother shapes, more expressive but still recognizable facial features, simplified fur detail, and tasteful character exaggeration. Keep the same role and wardrobe.`;
  }

  return `${shared} Make the pet rendering MASCOT: polished professional mascot styling, strongly recognizable pet identity, faithful markings and ears, modest expressive stylization, balanced proportions, and merchandise-ready finish. Keep the same role and wardrobe.`;
};

export const handleEditImageLook = async (imageUrl: string, look: EditorLook) => {
  try {
    const result = await fal.subscribe("fal-ai/flux-kontext/dev", {
      input: {
        image_url: imageUrl,
        prompt: getEditorLookPrompt(look),
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
