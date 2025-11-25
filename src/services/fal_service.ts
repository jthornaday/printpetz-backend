import { fal } from "@fal-ai/client";

import AppConstants from "@/constants/app_constants";

import { addErrorLog } from "./error_logs_service";

fal.config({ credentials: AppConstants.falApiKey });

export const handleTrainModel = async (datasetUrl: Blob, name: string) => {
  try {
    // Build input object
    const input = {
      image_data_url: datasetUrl,
      trigger_phrase: `TOK ${name}`,
    };

    // Submit job — check if SDK supports training endpoint
    const result = await fal.queue.submit("fal-ai/qwen-image-trainer", {
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
    const result = await fal.queue.submit("fal-ai/qwen-image", {
      input: {
        prompt,
        loras: [{ path }],
        num_images: 1,
        output_format: "jpeg",
        image_size: {
          width: 820,
          height: 1024,
        }, // 4:5 ratio
        negative_prompt:
          "blurry, low resolution, low quality, watermark, logo, text, cropped, out of frame, ugly face, cartoon, 3d, illustration, anime, multiple body parts",
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
