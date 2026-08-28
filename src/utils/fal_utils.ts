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
    return "NATURAL MODE: preserve realistic pet facial proportions, normal eye size, normal head size, and realistic fur detail. Do not use chibi, toy-like, baby-animal, oversized-eye, or oversized-head proportions. Only the body, wardrobe, pose, and scene should transform into the selected concept.";
  }

  if (cutenessLevel === 2) {
    return "CUTE MODE: keep the pet's real facial proportions and recognizable likeness dominant. Use normal-sized eyes and a nearly natural head size, with only subtle softening and charm. Do not use chibi proportions, giant eyes, a huge head, tiny legs, toy-like anatomy, or a baby-animal look. The character should feel like the real pet convincingly transformed into the selected role.";
  }

  if (cutenessLevel === 3) {
    return "EXTRA CUTE MODE: add moderate mascot charm with a modestly larger head, gently more expressive eyes, softer friendly features, and slightly compact proportions, but keep the pet clearly recognizable and avoid extreme chibi or toy-like anatomy.";
  }

  if (cutenessLevel === 4) {
    return "SUPER CUTE MODE: make the character clearly mascot-like with a larger head, bigger expressive eyes, softer rounded features, compact proportions, and polished animated-character appeal while preserving the pet's defining face, coat pattern, ears, muzzle, nose, and eye color.";
  }

  if (cutenessLevel === 5) {
    return "STOP IT, CUTE!: maximize adorable mascot appeal while preserving the pet's identity. Use noticeably enlarged expressive eyes, a larger head, soft rounded facial features, compact charming body proportions, playful premium character styling, and strong animated-mascot energy. Keep the pet unmistakably recognizable and avoid malformed anatomy or losing its real markings, ears, muzzle, nose, coat pattern, or eye color.";
  }

  return "Keep the pet recognizable and use a restrained cute treatment.";
};

export const generateIdentityPrompt = (subject: string, cutenessLevel = 2) =>
  `${subject}. IMPORTANT PRINTPETZ CHARACTER RULES: fully transform the trained pet into the selected role, outfit, pose, and environment described above. For sports and human-like roles, the pet must read as the actual participant, not a pet attending the event. Use an upright anthropomorphic body with believable shoulders, torso, arms, paws or hands, and role-appropriate wardrobe. Frame primarily from the waist or chest up unless the selected concept requires otherwise. Any equipment or prop must be visibly and anatomically supported, correctly gripped, worn, or resting on a believable surface; never allow floating, intersecting, or unsupported props. Do not recreate the original training-photo background, camera angle, pose, people, hands, furniture, blankets, couches, or setting. Do not show spectators or unrelated people. Do not invent real team logos, letters, trademarks, or recognizable professional sports branding unless licensed branding is explicitly supplied. Preserve the pet's identity: coat colors and pattern, facial markings, eye color, ear shape, muzzle shape, nose, and recognizable facial structure. Show one pet only. ${getCutenessPrompt(cutenessLevel)} Use a clean, simplified, purpose-built environment that supports the selected role without looking like a candid real-world snapshot. The result should feel like polished, premium, merchandise-ready PrintPetz artwork.`;
