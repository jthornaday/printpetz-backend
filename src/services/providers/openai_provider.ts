import AppConstants from "@/constants/app_constants";
import {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationFailure,
  ImageProvider,
  ProviderMeta,
} from "@/types/image_provider";

import { addErrorLog } from "../error_logs_service";

const EDITS_ENDPOINT = "https://api.openai.com/v1/images/edits";

// Published rates, USD per 1M tokens. Text output is not billed: the model
// returns an image, not prose.
const RATE_TEXT_INPUT = 5 / 1_000_000;
const RATE_IMAGE_INPUT = 8 / 1_000_000;
const RATE_IMAGE_OUTPUT = 30 / 1_000_000;

// OpenAI accepts up to 16 reference images on GPT image models and the 2.5
// docs are quoted at 10. 10 is the number we hold ourselves to; 5 is what a
// generation actually sends, which is the upper end of what a customer
// uploads for training anyway.
const REFERENCE_HARD_CAP = 10;
const DEFAULT_REFERENCE_COUNT = 5;

// 832x1024 rather than the FAL lane's 820x1024. OpenAI requires both edges to
// be multiples of 16 and 820 is not one, so this is the nearest legal size --
// 1.5% wider, same portrait framing.
const DEFAULT_SIZE = "832x1024";
const DEFAULT_MODEL = "gpt-image-2.5-flare";
const DEFAULT_QUALITY = "high";

const DEFAULT_TIMEOUT_MS = 120_000;

// Tier 1 allows five images a minute, and the bakeoff runs dozens. A 429 is
// the expected steady state there, not an exception, so it gets real retries
// while a 5xx gets the single retry the spec asks for.
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 4;
const MAX_SERVER_ERROR_RETRIES = 1;

const readIntEnv = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[generation-config] ${key}="${raw}" is not a non-negative integer. Using ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
};

const resolveReferenceUrls = (urls: string[]) => {
  const wanted = Math.min(
    readIntEnv("PRINTPETZ_OPENAI_REF_COUNT", DEFAULT_REFERENCE_COUNT),
    REFERENCE_HARD_CAP,
  );
  return (urls ?? []).filter(Boolean).slice(0, Math.max(wanted, 1));
};

type OpenAIUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

// Derived from the usage block rather than a per-image table, because OpenAI
// explicitly says the GPT Image 2 calculator does not estimate 2.5 token
// consumption. This reports what the call actually cost.
const estimateCostUsd = (usage?: OpenAIUsage) => {
  if (!usage) return undefined;

  const textTokens = usage.input_tokens_details?.text_tokens ?? 0;
  const imageTokens = usage.input_tokens_details?.image_tokens ?? 0;
  // If the details block is missing, fall back to charging all input at the
  // image rate: it is the dearer of the two, so the estimate never flatters.
  const inputCost =
    textTokens || imageTokens
      ? textTokens * RATE_TEXT_INPUT + imageTokens * RATE_IMAGE_INPUT
      : (usage.input_tokens ?? 0) * RATE_IMAGE_INPUT;

  return inputCost + (usage.output_tokens ?? 0) * RATE_IMAGE_OUTPUT;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Honour Retry-After when the server sends one; otherwise back off
// exponentially from one second. Capped so a bad header cannot park a request
// thread for an hour.
const retryDelayMs = (response: Response, attempt: number) => {
  const header = response.headers.get("retry-after");
  const fromHeader = header ? Number(header) * 1000 : NaN;
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return Math.min(fromHeader, 60_000);
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
};

const isModerationRefusal = (status: number, body: string) =>
  status === 400 && /moderation|safety|content_policy|rejected/i.test(body);

const callOpenAI = async (body: Record<string, unknown>) => {
  const apiKey = AppConstants.openaiApiKey;
  if (!apiKey) {
    throw new ImageGenerationFailure(
      "openai",
      "provider_error",
      "OPENAI_API_KEY is not set. The OpenAI lane cannot run without it.",
    );
  }

  const timeoutMs = readIntEnv(
    "PRINTPETZ_OPENAI_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
  );
  const maxRateLimitRetries = readIntEnv(
    "PRINTPETZ_OPENAI_MAX_RETRIES_429",
    DEFAULT_MAX_RATE_LIMIT_RETRIES,
  );

  let rateLimitAttempts = 0;
  let serverErrorAttempts = 0;

  // Bounded by the two counters below, not by the loop: every path either
  // returns, throws, or increments a counter that has a ceiling.
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(EDITS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (serverErrorAttempts < MAX_SERVER_ERROR_RETRIES) {
        serverErrorAttempts += 1;
        await sleep(1000);
        continue;
      }
      throw new ImageGenerationFailure(
        "openai",
        "provider_error",
        "OpenAI request failed or timed out",
        error instanceof Error ? error.message : String(error),
      );
    }
    clearTimeout(timer);

    if (response.ok) return response;

    const text = await response.text();

    if (response.status === 429) {
      if (rateLimitAttempts >= maxRateLimitRetries) {
        throw new ImageGenerationFailure(
          "openai",
          "rate_limit",
          `OpenAI rate limit not cleared after ${maxRateLimitRetries} retries`,
          text.slice(0, 500),
        );
      }
      const delay = retryDelayMs(response, rateLimitAttempts);
      rateLimitAttempts += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `[generation-config] OpenAI 429, retry ${rateLimitAttempts}/${maxRateLimitRetries} in ${delay}ms`,
      );
      await sleep(delay);
      continue;
    }

    if (isModerationRefusal(response.status, text)) {
      throw new ImageGenerationFailure(
        "openai",
        "moderation",
        "OpenAI refused the prompt on moderation grounds",
        text.slice(0, 500),
      );
    }

    if (
      response.status >= 500 &&
      serverErrorAttempts < MAX_SERVER_ERROR_RETRIES
    ) {
      serverErrorAttempts += 1;
      await sleep(retryDelayMs(response, serverErrorAttempts));
      continue;
    }

    throw new ImageGenerationFailure(
      "openai",
      "provider_error",
      `OpenAI returned ${response.status}`,
      text.slice(0, 500),
    );
  }
};

export const openAIImageProvider: ImageProvider = {
  name: "openai",

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const references = resolveReferenceUrls(request.referenceImageUrls);
    if (references.length === 0) {
      throw new ImageGenerationFailure(
        "openai",
        "provider_error",
        "This pet has no training photos, so there is nothing to reference",
      );
    }

    const model = process.env.PRINTPETZ_OPENAI_MODEL?.trim() || DEFAULT_MODEL;
    const size = process.env.PRINTPETZ_OPENAI_SIZE?.trim() || DEFAULT_SIZE;
    const quality =
      process.env.PRINTPETZ_OPENAI_QUALITY?.trim() || DEFAULT_QUALITY;
    const outputFormat = "jpeg";

    // One line per generation, deliberately the same shape as the FAL lane's
    // so an A/B can be reconstructed from logs alone. Note what is NOT here:
    // a seed. The images API has no seed parameter, so the OpenAI arm cannot
    // be pinned the way PRINTPETZ_FIXED_SEED pins FAL.
    // eslint-disable-next-line no-console
    console.log(
      "[generation-config]",
      JSON.stringify({
        provider: "openai",
        model,
        size,
        quality,
        styleName: request.styleName ?? null,
        referenceCount: references.length,
        seedSupported: false,
        promptChars: request.prompt.length,
      }),
    );

    const startedAt = Date.now();

    const response = await callOpenAI({
      model,
      prompt: request.prompt,
      images: references.map((url) => ({ image_url: url })),
      size,
      quality,
      n: 1,
      output_format: outputFormat,
    });

    const payload = (await response.json()) as {
      id?: string;
      data?: Array<{ b64_json?: string }>;
      usage?: OpenAIUsage;
    };

    const latencyMs = Date.now() - startedAt;
    const b64 = payload.data?.[0]?.b64_json;

    if (!b64) {
      throw new ImageGenerationFailure(
        "openai",
        "provider_error",
        "OpenAI returned no image data",
      );
    }

    const providerMeta: ProviderMeta = {
      latencyMs,
      responseId:
        payload.id ?? response.headers.get("x-request-id") ?? undefined,
      costUsd: estimateCostUsd(payload.usage),
      usage: payload.usage as Record<string, unknown> | undefined,
    };

    // eslint-disable-next-line no-console
    console.log(
      "[generation-config]",
      JSON.stringify({ provider: "openai", model, ...providerMeta }),
    );

    return {
      kind: "complete",
      provider: "openai",
      providerModel: model,
      image: {
        buffer: Buffer.from(b64, "base64"),
        contentType: "image/jpeg",
        extension: "jpg",
      },
      providerMeta,
    };
  },
};

// Exported for the bakeoff script, which reports spend without re-deriving the
// rate card.
export const estimateOpenAICostUsd = estimateCostUsd;

export const logOpenAIFailure = (
  failure: ImageGenerationFailure,
  context: Record<string, unknown>,
) => {
  addErrorLog({
    error: JSON.stringify({
      reason: failure.reason,
      message: failure.message,
      detail: failure.detail,
    }),
    input: JSON.stringify(context),
    type: "IMAGE_GENERATION_OPENAI",
  });
};
