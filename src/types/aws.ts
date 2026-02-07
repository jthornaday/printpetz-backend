export interface IS3StreamUploadProps {
  Key: string;
  url: string;
  fileType: string;
}

export interface IS3FileUploadProps {
  Key: string;
  buffer: Buffer;
  fileType: string;
}

export enum EUploadPath {
  PROFILE_IMAGE = "profile-images/[USER_ID]",
  GENERATION_IMAGE = "generations/[USER_ID]",
  TRAINING_IMAGE = "training-images/[USER_ID]",
  MODEL = "models/[USER_ID]",
}
