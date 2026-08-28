import axios from "axios";
import JSZip from "jszip";

import { addErrorLog } from "@/services/error_logs_service";
import errorResponse from "@/utils/errors/errorResponse";

const MINIMUM_TRAINING_IMAGES = 3;

interface CreateDatasetZipOptions {
  imageUrls: string[];
}

export const createTrainingZip = async ({
  imageUrls,
}: CreateDatasetZipOptions): Promise<Blob> => {
  try {
    const zip = new JSZip();
    let successfulImageCount = 0;

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];

      try {
        const imageResponse = await axios.get(url, {
          responseType: "arraybuffer",
        });
        const contentType = imageResponse.headers["content-type"];

        if (contentType && !contentType.startsWith("image/")) {
          throw new Error(`Unsupported training file type: ${contentType}`);
        }

        if (!imageResponse.data?.byteLength) {
          throw new Error("Training image is empty");
        }

        const filename = `image_${successfulImageCount + 1}.jpg`;
        zip.file(filename, imageResponse.data);
        successfulImageCount += 1;
      } catch (error) {
        addErrorLog({
          input: JSON.stringify({ url }),
          error: JSON.stringify({ error }),
          type: "FETCH_FILE",
        });
      }
    }

    if (successfulImageCount < MINIMUM_TRAINING_IMAGES) {
      throw errorResponse.Api400Error({
        errorDescription:
          "At least 3 readable pet photos are required. Please replace any photos that failed to upload.",
      });
    }

    const content = await zip.generateAsync({ type: "blob" });
    return content;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ imageUrls }),
      error: JSON.stringify({ error }),
      type: "CREATE_TRAINING_ZIP",
    });

    throw error;
  }
};

const getCutenessPrompt = (cutenessLevel: number) => {
  if (cutenessLevel === 1) {
    return "Keep the character mostly natural and realistic, with only gentle mascot stylization and normal head-to-body proportions.";
  }

  if (cutenessLevel === 3) {
    return "Push the character noticeably cuter: slightly larger head, slightly larger expressive eyes, softer friendly features, compact mascot proportions, and charming premium animated-character appeal while preserving the pet's true identity.";
  }

  return "Use a balanced cute mascot treatment: slightly larger head, subtly larger expressive eyes, softer friendly features, and polished character proportions while preserving the pet's true identity.";
};

export const generateIdentityPrompt = (subject: string, cutenessLevel = 2) =>
  `${subject}. IMPORTANT PRINTPETZ MASCOT RULES: fully transform the trained pet into the selected style, role, outfit, pose, and environment described above. Use an upright anthropomorphic character body whenever the selected concept implies a human role or sport. Frame the character primarily from the waist or chest up unless the selected style specifically requires otherwise. Do not recreate, copy, or preserve the original training-photo background, camera angle, pose, clothing, people, hands, furniture, blankets, couches, or setting. Do not show spectators or unrelated people. Do not invent or reproduce real team logos, letters, trademarks, or recognizable professional sports branding unless the selected style explicitly supplies licensed branding. The selected style and scene must be unmistakably visible. Preserve the pet's identity: the same coat colors and pattern, facial markings, eye color, ear shape, muzzle shape, nose, and recognizable facial proportions. Show one pet only. ${getCutenessPrompt(cutenessLevel)} Use a clean, simplified, stylized environment rather than a documentary photo scene. The result should feel like polished, premium, merchandise-ready PrintPetz artwork with sharp facial detail and clean professional image quality.`;
