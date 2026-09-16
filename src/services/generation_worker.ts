import AppConstants from "@/constants/app_constants";
import { EGenerationStatus, IGeneration } from "@/types/generation";
import { ImageGenerationFailure } from "@/types/image_provider";

import { addErrorLog } from "./error_logs_service";
import {
  claimQueuedGeneration,
  findStrandedGenerations,
  providerColumns,
  updateGeneration,
  uploadGenerationImageBuffer,
} from "./generation_service";
import { getModelById } from "./model_service";
import { getStyleById } from "./style_service";
import { getImageProvider } from "./providers";
import { updateUserCredit } from "./user_service";

/**
 * Drains queued generations off the request thread.
 *
 * Why this exists: FAL is queued, so createImage could submit N images and
 * return in milliseconds. OpenAI is synchronous and took 21-84 seconds per
 * image in the bakeoff, so the same code held one HTTP connection open for
 * minutes. Node does not abort a handler when the client disconnects, so on
 * 16 Sept the work completed, the rows were written and the credits were
 * charged -- and the customer saw nothing, because the frontend only refetches
 * after the request resolves.
 *
 * So the request now inserts rows and returns, and this drains them. The
 * frontend polls rows in GENERATING exactly as it already does for FAL, which
 * is why queued rows are inserted as GENERATING rather than PENDING: PENDING
 * is a status the deployed frontend does not know about, and inventing a
 * deploy-ordering problem to express "queued" is not worth it.
 */

// Tier 1 allows five images a minute. The bakeoff paced itself to exactly this
// and ran 52/52; the production path had no pacing at all, which is how a
// four-image batch turned into concurrent calls, 429s and backoff. One image
// at a time, spaced, is both simpler and faster in wall-clock terms than four
// racing each other into a rate limit.
const IMAGES_PER_MINUTE = Number(
  process.env.PRINTPETZ_OPENAI_IMAGES_PER_MINUTE ?? 5,
);
const MIN_GAP_MS = Math.ceil(60_000 / Math.max(IMAGES_PER_MINUTE, 1));

// How long a row may sit unfinished before it is treated as abandoned. Longer
// than the slowest plausible batch, short enough that a customer is not left
// staring at a spinner.
const STRANDED_AFTER_MS = Number(
  process.env.PRINTPETZ_STRANDED_AFTER_MS ?? 15 * 60_000,
);
const SWEEP_EVERY_MS = 60_000;

// Idle backoff. Nothing queued is the normal state, and polling an empty table
// five times a minute forever is wasteful.
const IDLE_POLL_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const workerId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let running = false;

const refund = async (generation: IGeneration) => {
  await updateUserCredit(
    generation.user_id,
    AppConstants.imageGenerationCredit,
    true,
  );
};

const failGeneration = async (
  generation: IGeneration,
  reason: string,
  message: string,
) => {
  // Credits are taken up front, matching the FAL lane, so a failure has to give
  // them back. Refund first: if the process dies between the two, an ERROR row
  // with the credit already returned is a better state to be in than a
  // COMPLETED-looking row the customer paid for and never received.
  await refund(generation);
  await updateGeneration({
    id: generation.id,
    status: EGenerationStatus.ERROR,
    error: { reason, message },
  });
};

const processOne = async (generation: IGeneration) => {
  const provider = getImageProvider();

  const [model, style] = await Promise.all([
    getModelById(generation.model_id),
    getStyleById(generation.style_id),
  ]);

  if (!model || !style) {
    await failGeneration(
      generation,
      "provider_error",
      "Pet or style no longer exists",
    );
    return;
  }

  try {
    // The prompt was assembled and stored when the row was created, so the
    // worker never rebuilds it -- a prompt that drifted between queueing and
    // running would make the row a record of something that did not happen.
    const result = await provider.generate({
      prompt: generation.prompt,
      modelPath: model.model_path,
      referenceImageUrls: model.training_images ?? [],
      petName: model.pet_name?.trim() || model.name,
      seed: generation.seed ?? 0,
      styleName: style.name,
    });

    if (result.kind !== "complete") {
      // Only a synchronous provider should ever reach the worker. A queued one
      // would mean PRINTPETZ_IMAGE_PROVIDER changed under a running batch.
      await failGeneration(
        generation,
        "provider_error",
        "Queued row was picked up by a provider that does not generate synchronously",
      );
      return;
    }

    const imageUrl = await uploadGenerationImageBuffer(
      generation.user_id,
      result.image.buffer,
      result.image.contentType,
      result.image.extension,
    );

    if (!imageUrl) {
      await failGeneration(
        generation,
        "provider_error",
        "Generated image could not be stored",
      );
      return;
    }

    await updateGeneration({
      id: generation.id,
      status: EGenerationStatus.COMPLETED,
      image: imageUrl,
      request_id: result.providerMeta.responseId ?? null,
      ...providerColumns(result.provider, result.providerModel),
    });
  } catch (error) {
    const failure =
      error instanceof ImageGenerationFailure
        ? error
        : new ImageGenerationFailure(
            provider.name,
            "provider_error",
            error instanceof Error ? error.message : String(error),
          );

    addErrorLog({
      error: JSON.stringify({
        reason: failure.reason,
        message: failure.message,
        detail: failure.detail,
        status: failure.status,
      }),
      input: JSON.stringify({
        generationId: generation.id,
        styleId: generation.style_id,
      }),
      type: "IMAGE_GENERATION_QUEUED",
    });

    await failGeneration(generation, failure.reason, failure.message);
  }
};

/**
 * Anything left GENERATING past the threshold is abandoned -- a deploy, a
 * restart, a crash mid-image. Without this, a restart during a batch leaves a
 * customer charged and staring at a spinner that will never resolve, which is
 * the worst outcome available.
 */
export const sweepStrandedGenerations = async () => {
  const stranded = await findStrandedGenerations(STRANDED_AFTER_MS);
  if (stranded.length === 0) return 0;

  for (const generation of stranded) {
    await failGeneration(
      generation,
      "provider_error",
      "Generation did not finish and was cleaned up",
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    "[generation-worker]",
    JSON.stringify({ workerId, swept: stranded.length }),
  );
  return stranded.length;
};

const loop = async () => {
  let lastSweep = 0;

  for (;;) {
    try {
      if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
        lastSweep = Date.now();
        await sweepStrandedGenerations();
      }

      const claimed = await claimQueuedGeneration(
        `queued:${workerId}:${Date.now()}`,
      );

      if (!claimed) {
        await sleep(IDLE_POLL_MS);
        continue;
      }

      const startedAt = Date.now();
      await processOne(claimed);

      // Pace from the START of the last call, not the end: a 30-second
      // generation has already spent most of the interval.
      const remaining = MIN_GAP_MS - (Date.now() - startedAt);
      if (remaining > 0) await sleep(remaining);
    } catch (error) {
      // The loop must not be killable by one bad iteration.
      addErrorLog({
        error: JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
        input: JSON.stringify({ workerId }),
        type: "GENERATION_WORKER_LOOP",
      });
      await sleep(IDLE_POLL_MS);
    }
  }
};

export const startGenerationWorker = () => {
  if (running) return;
  running = true;

  // eslint-disable-next-line no-console
  console.log(
    "[generation-worker]",
    JSON.stringify({
      workerId,
      imagesPerMinute: IMAGES_PER_MINUTE,
      strandedAfterMs: STRANDED_AFTER_MS,
    }),
  );

  void loop();
};
