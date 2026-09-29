import AsyncHandler from "@/context/async_handler";
import { getGenerationById } from "@/services/generation_service";
import { getPetNameForPrint } from "@/services/model_service";
import { ensurePreviews, previewsEnabled } from "@/services/merch_preview_service";
import errorResponse from "@/utils/errors/errorResponse";

/**
 * GET /merch/previews/:generationId — previews of this generation on every shop
 * product. Idempotent; the shop polls it until nothing is pending.
 *
 * Owner-only: previews may run background removal, a paid call, and this must not
 * become a free rembg API for anyone's images.
 */
const getPreviews = AsyncHandler.handle(async (req, res) => {
  if (!previewsEnabled()) throw errorResponse.Api404Error({ errorDescription: "Not found" });

  const generationId = Number(req.params.generationId);
  if (!Number.isInteger(generationId) || generationId <= 0) {
    throw errorResponse.Api400Error({ errorDescription: "Invalid generation id" });
  }
  const generation = await getGenerationById(generationId);
  if (!generation || generation.user_id !== req.user.id || !generation.image) {
    throw errorResponse.Api404Error({ errorDescription: "Image not found" });
  }

  // Same URL the order webhook will fetch, so the same bytes, hash and rembg mask.
  const src = await fetch(generation.image);
  if (!src.ok) throw new Error(`generation image fetch failed ${src.status}`);
  // Products that print the pet's name (pet bowl) preview the same server-side name the order prints.
  const displayName = await getPetNameForPrint(generation.model_id);
  const manifest = await ensurePreviews(Buffer.from(await src.arrayBuffer()), { displayName });

  res.dataFetchSuccess({ data: { generationId, sourceUrl: generation.image, ...manifest } });
});

export { getPreviews };
