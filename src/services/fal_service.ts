import { fal } from "@fal-ai/client";

import AppConstants from "@/constants/app_constants";

import { addErrorLog } from "./error_logs_service";

fal.config({ credentials: AppConstants.falApiKey });

export const handleTrainModel = async (datasetUrl: Blob, name: string) => {
  try {
    // 400 steps is a faster production balance than the previous 500 while
    // still leaving enough training iterations for pet identity retention.
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
        // Preserve the trained pet while leaving the prompt room to control
        // wardrobe, pose, props, and background.
        loras: [{ path, scale: isFluxModel ? 0.95 : 1.0 }],
        num_images: 1,
        // Reduce inference work from 30/40 to 24/32 for quicker generation.
        // FAL's FLUX LoRA defaults are around 28 steps, so 24 remains a
        // conservative quality/speed tradeoff rather than an extreme cut.
        num_inference_steps: isFluxModel ? 24 : 32,
        guidance_scale: isFluxModel ? 4.0 : 2.5,
        ...(isFluxModel ? { acceleration: "regular" as const } : {}),
        output_format: "jpeg",
        image_size: {
          width: 820,
          height: 1024,
        },
        negative_prompt:
          "blurry, low resolution, low quality, watermark, logo, text, cropped face, out of frame, distorted face, deformed anatomy, duplicate animal, multiple pets, extra limbs, extra ears, extra eyes, giant eyes, oversized cartoon eyes, extreme chibi, toy-like anatomy, photorealistic candid snapshot, spectators, crowd, unrelated people, couch, blanket, furniture, source photo background, floating object, floating bat, unsupported prop, intersecting prop, missing uniform",
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
