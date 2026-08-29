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

const getLookPrompt = (lookLevel: number) => {
  if (lookLevel === 1) {
    return "NATURAL LOOK: keep the exact same full anthropomorphic role transformation, wardrobe, pose, equipment, and participant body language, but make the pet's face stay as close as possible to the real trained pet. Preserve realistic facial proportions, normal eye size, natural head size, true muzzle length and shape, exact ear shape, nose, coat texture, coat pattern, markings, and eye color. Do not reduce the anthropomorphism: this must still clearly be the pet actively functioning as the boxer, baseball player, golfer, doctor, firefighter, or other selected role. Avoid chibi, mascot exaggeration, toy-like anatomy, giant eyes, or an oversized head.";
  }

  if (lookLevel === 3) {
    return "CARTOON LOOK: keep the exact same full anthropomorphic role transformation, wardrobe, pose, equipment, and participant body language, but render the pet with a clearly illustrated animated-cartoon treatment. Allow more expressive eyes, smoother shapes, simplified fur detail, and tasteful exaggerated character proportions while preserving the pet's defining facial markings, ear shape, muzzle, nose, coat colors and pattern, and overall identity. The pet must still unmistakably perform the selected role rather than merely attend the scene.";
  }

  return "MASCOT LOOK: keep the exact same full anthropomorphic role transformation, wardrobe, pose, equipment, and participant body language. Render the pet as a polished professional mascot: strongly recognizable as the real pet, with faithful coat pattern, markings, ears, muzzle, nose, and eye color, plus modestly enhanced expression and clean merchandise-ready character styling. Use balanced mascot proportions without giant eyes, extreme chibi, toy-like anatomy, or losing the pet's identity. The pet must clearly be the boxer, baseball player, golfer, doctor, firefighter, or other selected role.";
};

export const generateIdentityPrompt = (subject: string, lookLevel = 2) =>
  `${subject}. IMPORTANT PRINTPETZ CHARACTER RULES: fully transform the trained pet into the selected role, outfit, pose, and environment described above. For sports and human-like roles, the pet must read as the actual participant, not a pet attending the event. Use an upright anthropomorphic body with believable shoulders, torso, arms, paws or hands, and role-appropriate wardrobe. Frame primarily from the waist or chest up unless the selected concept requires otherwise. Any equipment or prop must be visibly and anatomically supported, correctly gripped, worn, or resting on a believable surface; never allow floating, intersecting, or unsupported props. Do not recreate the original training-photo background, camera angle, pose, people, hands, furniture, blankets, couches, or setting. Do not show spectators or unrelated people. Do not invent real team logos, letters, trademarks, or recognizable professional sports branding unless licensed branding is explicitly supplied. Preserve the pet's identity: coat colors and pattern, facial markings, eye color, ear shape, muzzle shape, nose, and recognizable facial structure. Show one pet only. ${getLookPrompt(lookLevel)} Use a clean, simplified, purpose-built environment that supports the selected role without looking like a candid real-world snapshot. The result should feel like polished, premium, merchandise-ready PrintPetz artwork.`;
