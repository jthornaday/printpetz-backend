import axios from "axios";

import { addErrorLog } from "./error_logs_service";

/**
 * Fetches an MP3 file from the given URL and returns it as a Buffer.
 * @param {string} url - The URL of the MP3 file.
 * @returns {Promise<Buffer>} - The MP3 file as a Buffer.
 */
export const getFileBufferFromUrl = async (
  url: string,
  fileType?: string,
): Promise<Buffer> => {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      ...(fileType && { headers: { Accept: fileType } }),
    });

    return Buffer.from(response.data);
  } catch (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ url }),
      type: "FILE_TO_BUFFER",
    });
    throw new Error("Failed to fetch buffer from file URL");
  }
};

export const getStreamResponseFromUrl = async (
  url: string,
  fileType?: string,
): Promise<Buffer> => {
  try {
    const response = await axios.get(url, {
      responseType: "stream",
    });

    console.log(response.headers);

    return response.data;
  } catch (error) {
    addErrorLog({
      error: JSON.stringify(error),
      input: JSON.stringify({ url }),
      type: "FILE_TO_STREAM",
    });
    throw new Error("Failed to fetch stream from file URL");
  }
};
