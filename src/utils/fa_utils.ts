import axios from "axios";
import JSZip from "jszip";

import {
  ACTIONS,
  CAMERA,
  LIGHTING,
  LOCATIONS,
  QUALITY,
} from "@/constants/prompts";
import { addErrorLog } from "@/services/error_logs_service";

interface CreateDatasetZipOptions {
  imageUrls: string[];
}

export const createTrainingZip = async ({
  imageUrls,
}: CreateDatasetZipOptions): Promise<Blob> => {
  try {
    const zip = new JSZip();

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const ext = "jpg";
      const filename = `image_${i + 1}.${ext}`;

      try {
        // 1️⃣ Download image as buffer
        const imageResponse = await axios.get(url, {
          responseType: "arraybuffer",
        });

        zip.file(filename, imageResponse.data);
      } catch (error) {
        addErrorLog({
          input: JSON.stringify({ url }),
          error: JSON.stringify({ error }),
          type: "FETCH_FILE",
        });
      }

      // 2️⃣ Add image file

      // 3️⃣ Add caption file with trigger phrase
      // const captionFilename = `image_${i + 1}.txt`;
      // zip.file(captionFilename, triggerPhrase);
    }

    // 4️⃣ Generate ZIP Blob
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

export const generateRandomPrompt = (subject: string, category: string) => {
  const random = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  return `${subject}, ${random(ACTIONS[category])}, ${random(LOCATIONS[category])}, ${random(LIGHTING)}, ${random(CAMERA)}, ${random(QUALITY)}.`;
};
