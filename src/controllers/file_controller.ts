import AsyncHandler from "@/context/async_handler";
import { uploadFileToS3 } from "@/services/aws_service";
import { addErrorLog } from "@/services/error_logs_service";
import { EUploadPath } from "@/types/aws";
import errorResponse from "@/utils/errors/errorResponse";
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
      const uploadData = {
        buffer: file.buffer,
        fileType: file.mimetype,
        Key: `${folderPath.replace("[USER_ID]", user.id)}/${randomId}-${file.originalname}`,
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
