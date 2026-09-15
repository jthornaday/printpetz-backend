import {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProvider,
} from "@/types/image_provider";

import { handleGenerateImage } from "../fal_service";

/**
 * A wrapper, deliberately and completely. Every decision about endpoints,
 * LoRA scale, pose references and negative prompts still lives in
 * fal_service.handleGenerateImage, which this does not touch. Adding a second
 * provider must not change a single pixel of the lane that currently works.
 */
export const falProvider: ImageProvider = {
  name: "fal",

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const requestId = await handleGenerateImage(
      request.prompt,
      request.modelPath,
      request.seed,
      request.styleName,
    );

    return {
      kind: "queued",
      provider: "fal",
      // The LoRA path is the only per-generation model identity FAL has.
      providerModel: request.modelPath,
      requestId: String(requestId),
    };
  },
};
