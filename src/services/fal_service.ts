import { fal } from "@fal-ai/client";

import AppConstants from "@/constants/app_constants";

import { addErrorLog } from "./error_logs_service";

fal.config({ credentials: AppConstants.falApiKey });

export const handleTrainModel = async (datasetUrl: Blob) => {
  try {
    // Build input object
    const input = {
      image_data_url: datasetUrl,
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
