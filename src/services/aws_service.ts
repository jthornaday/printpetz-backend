import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import AppConstants from "@/constants/app_constants";
import { IS3UploadProps } from "@/types/aws";

import { addErrorLog } from "./error_logs_service";
import { getFileBufferFromUrl, getStreamResponseFromUrl } from "./file_service";

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: AppConstants.awsAccessKey, // Your AWS Access Key
    secretAccessKey: AppConstants.awsSecretKey, // Your AWS Secret Key
  },
});

const Bucket = AppConstants.awsBucketName;

export const uploadFileToS3 = async (input: IS3UploadProps) => {
  const { Key, buffer, fileType } = input;

  try {
    const uploadParams = {
      Bucket,
      Key,
      Body: buffer, // File content (buffer)
      ContentType: fileType, // Adjust the content type accordingly
    };

    const command = new PutObjectCommand(uploadParams);
    await s3.send(command);

    return `${AppConstants.cloudfrontDomain}/${Key}`;
  } catch (err) {
    addErrorLog({
      error: JSON.stringify(err),
      input: JSON.stringify({
        Key,
        fileType,
        fileBase64: Buffer.from(buffer).toString("base64"),
      }),
      type: "FILE_UPLOAD_TO_AWS",
    });
    return null;
  }
};

export const streamUploadToS3 = async (input: IS3UploadProps) => {
  const { Key, url, fileType } = input;

  const resStream = await getStreamResponseFromUrl(url, fileType);

  try {
    const uploadParams = {
      Bucket,
      Key,
      Body: resStream,
      ContentType: fileType, // Adjust the content type accordingly
    };

    const command = new PutObjectCommand(uploadParams);
    await s3.send(command);

    return `${AppConstants.cloudfrontDomain}/${Key}`;
  } catch (err) {
    addErrorLog({
      error: JSON.stringify(err),
      input: JSON.stringify({ Key, fileType, url }),
      type: "FILE_UPLOAD_TO_AWS",
    });
    return null;
  }
};
