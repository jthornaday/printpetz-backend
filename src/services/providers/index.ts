import { ImageProvider, ImageProviderName } from "@/types/image_provider";

import { falProvider } from "./fal_provider";
import { openAIImageProvider } from "./openai_provider";

const PROVIDERS: Record<ImageProviderName, ImageProvider> = {
  fal: falProvider,
  openai: openAIImageProvider,
};

/**
 * Read at call time, not at module load, so switching lanes in Elastic
 * Beanstalk takes effect on restart without a deploy -- the same rule the
 * LoRA scale and seed knobs already follow.
 *
 * Defaults to fal. An unrecognised value falls back to fal loudly rather than
 * failing the request: a typo in an env var must never take generation down.
 */
export const getImageProvider = (): ImageProvider => {
  const raw = process.env.PRINTPETZ_IMAGE_PROVIDER?.trim().toLowerCase();
  if (!raw) return PROVIDERS.fal;

  const provider = PROVIDERS[raw as ImageProviderName];
  if (!provider) {
    // eslint-disable-next-line no-console
    console.warn(
      `[generation-config] PRINTPETZ_IMAGE_PROVIDER="${raw}" is not fal or openai. Falling back to fal.`,
    );
    return PROVIDERS.fal;
  }

  return provider;
};

export { falProvider, openAIImageProvider };
