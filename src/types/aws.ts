export interface IS3UploadProps {
  Key: string;
  buffer?: Buffer;
  url?: string;
  fileType: string;
}

export enum EUploadPath {
  PROFILE_IMAGE = "profile-images/[USER_ID]",
  GENERATION_IMAGE = "generations/[USER_ID]",
  TRAINING_IMAGE = "training-images/[USER_ID]",
  MODEL = "models/[USER_ID]",
}
