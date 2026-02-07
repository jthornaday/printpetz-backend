import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import AppConstants from "@/constants/app_constants";
import { IS3FileUploadProps, IS3StreamUploadProps } from "@/types/aws";

import { addErrorLog } from "./error_logs_service";
import { getStreamResponseFromUrl } from "./file_service";

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: AppConstants.awsAccessKey, // Your AWS Access Key
    secretAccessKey: AppConstants.awsSecretKey, // Your AWS Secret Key
  },
});

const Bucket = AppConstants.awsBucketName;

export const uploadFileToS3 = async (input: IS3FileUploadProps) => {
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

export const streamUploadToS3 = async (input: IS3StreamUploadProps) => {
  const { Key, url, fileType } = input;

  const resStream = await getStreamResponseFromUrl(url);

  try {
    const parallelUploads3 = new Upload({
      client: s3,
      params: {
        Bucket,
        Key,
        Body: resStream,
        ContentType: fileType,
      },
    });

    parallelUploads3.on("httpUploadProgress", (progress) => {
      console.log(
        `Upload progress: ${progress.loaded} / ${progress.total}, Part: ${progress.part}`,
      );
    });

    await parallelUploads3.done();

    return `${AppConstants.cloudfrontDomain}/${Key}`;
  } catch (err) {
    addErrorLog({
      error: JSON.stringify(err),
      input: JSON.stringify({ Key, fileType, url }),
      type: "STREAM_FILE_UPLOAD_TO_AWS",
    });
    return null;
  }
};
