import { fal } from "@fal-ai/client";

import AppConstants from "@/constants/app_constants";

import { addErrorLog } from "./error_logs_service";

fal.config({ credentials: AppConstants.falApiKey });

export const handleTrainModel = async (datasetUrl: Blob, name: string) => {
  try {
    // Build input object
    const input = {
      images_data_url: datasetUrl,
      trigger_word: "TOK",
      create_masks: true,
      is_style: false,
      steps: 500,
    };

    // Submit job — check if SDK supports training endpoint
    const result = await fal.queue.submit("fal-ai/flux-lora-fast-training", {
      input,
      webhookUrl: `${AppConstants.serverBaseUrl}/webhook/fal/training-result`,
    });

    console.log({ result });

    // result.requestId etc
    const requestId = result.request_id;

    return requestId;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({}),
      error: JSON.stringify({ error }),
      type: "MODEL_TRAIN_REQUEST",
    });
    throw error;
  }
};

export const handleGenerateImage = async (prompt: string, path: string) => {
  try {
    const isFluxModel = path.includes("/flux/");
    const endpoint = isFluxModel ? "fal-ai/flux-lora" : "fal-ai/qwen-image";

    const result = await fal.queue.submit(endpoint, {
      input: {
        prompt,
        // Keep enough LoRA influence to preserve the pet's identity, but give the
        // prompt substantially more room to control wardrobe, body, pose, props,
        // and background. The previous 1.15 scale was overpowering the scene
        // instructions and recreating the training-photo look.
        loras: [{ path, scale: isFluxModel ? 0.8 : 1.0 }],
        num_images: 1,
        num_inference_steps: isFluxModel ? 30 : 40,
        guidance_scale: isFluxModel ? 4.5 : 2.5,
        ...(isFluxModel ? { acceleration: "regular" as const } : {}),
        output_format: "jpeg",
        image_size: {
          width: 820,
          height: 1024,
        }, // 4:5 ratio
        negative_prompt:
          "blurry, low resolution, low quality, watermark, logo, text, cropped face, out of frame, distorted face, deformed anatomy, duplicate animal, multiple pets, extra limbs, extra ears, extra eyes, photorealistic snapshot, documentary photo, spectators, crowd, unrelated people, couch, blanket, furniture, source photo background, floating object, floating bat, unsupported prop, intersecting prop, missing uniform",
      },
      webhookUrl: `${AppConstants.serverBaseUrl}/webhook/fal/generation-result`,
    });

    return result.request_id;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ prompt, path }),
      error: JSON.stringify({ error }),
      type: "IMAGE_GENERATION",
    });
    throw error;
  }
};
