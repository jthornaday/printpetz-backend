import AsyncHandler from "@/context/async_handler";
import { uploadFileToS3 } from "@/services/aws_service";
import { addErrorLog } from "@/services/error_logs_service";
import { EUploadPath } from "@/types/aws";
import errorResponse from "@/utils/errors/errorResponse";
import {
  convertToSrgbJpeg,
  sniffFormat,
  UnsupportedImageError,
} from "@/utils/image_conversion";
import { uploadFileSchema } from "@/utils/validation/file_validation_schema";

const uploadFile = AsyncHandler.handle(async (req, res) => {
  const user = req.user;
  const files = req.files as Express.Multer.File[];
  if (!files?.length) {
    throw errorResponse.Api400Error({
      errorDescription: "min 1 file required",
    });
  }

  const { type } = uploadFileSchema.parse(req.query);

  const folderPath = (EUploadPath[type] || "images") as string; // by default image path

  // Only training images. They are the only uploads that become reference
  // photos for an image model, so they are the only ones this can break.
  const normaliseColour = type === "TRAINING_IMAGE";

  // Whole batch or nothing. A training set that lost one photo to a rejected
  // format looks like it uploaded and then trains on the wrong thing, which is
  // worse than a clear error -- so every file is checked before any is stored.
  if (normaliseColour) {
    for (const file of files) {
      const format = sniffFormat(file.buffer);
      if (format === "image/heic") {
        throw errorResponse.Api400Error({
          errorDescription:
            `"${file.originalname}" is in Apple's HEIC format, which we can't read. ` +
            "On iPhone, go to Settings > Camera > Formats and choose Most " +
            "Compatible, then re-take or re-export the photo as a JPEG.",
        });
      }
      if (!["image/png", "image/jpeg", "image/webp"].includes(format)) {
        throw errorResponse.Api400Error({
          errorDescription: `"${file.originalname}" isn't a JPEG, PNG or WebP image. Please upload one of those.`,
        });
      }
    }
  }

  const fileUrls = await Promise.all(
    files.map(async (file) => {
      const randomId = Date.now().toString();
      if (!Buffer.from(file.buffer).length) {
        addErrorLog({
          error: "Empty file Uploaded",
          input: JSON.stringify({
            base64: Buffer.from(file.buffer).toString("base64"),
            file,
          }),
          type: "EMPTY_FILE_UPLOADED",
        });
      }

      let buffer = file.buffer;
      let wasConverted = false;
      // file.mimetype is whatever the browser guessed, and storing it is what
      // let mislabelled files through in the first place. The stored type now
      // comes from the bytes.
      let fileType = normaliseColour ? sniffFormat(file.buffer) : file.mimetype;

      if (normaliseColour) {
        try {
          const result = await convertToSrgbJpeg(file.buffer, file.originalname);
          buffer = result.buffer;
          fileType = result.contentType;
          wasConverted = result.converted;

          if (result.converted) {
            // eslint-disable-next-line no-console
            console.log(
              "[upload-config]",
              JSON.stringify({
                file: file.originalname,
                replacedProfile: result.replacedProfile,
                bytesBefore: file.buffer.length,
                bytesAfter: buffer.length,
              }),
            );
          }
        } catch (error) {
          if (error instanceof UnsupportedImageError) {
            throw errorResponse.Api400Error({ errorDescription: error.message });
          }
          throw error;
        }
      }

      // A converted file holds JPEG bytes whatever it arrived as, so the key
      // must not keep saying .png. The Content-Type is what actually matters
      // to a consumer, but a URL that disagrees with its own bytes is the
      // kind of thing that costs an hour to diagnose later.
      const name = wasConverted
        ? file.originalname.replace(/\.[^.]+$/, "") + ".jpg"
        : file.originalname;

      const uploadData = {
        buffer,
        fileType,
        Key: `${folderPath.replace("[USER_ID]", user.id)}/${randomId}-${name}`,
      };

      return uploadFileToS3(uploadData);
    }),
  );

  res.dataUpdateSuccess({
    message: "File uploaded successfully",
    data: { fileUrls },
  });
});

export { uploadFile };
