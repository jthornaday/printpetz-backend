export enum EModelStatus {
  PENDING = "PENDING",
  TRAINING = "TRAINING",
  COMPLETED = "COMPLETED",
  ERROR = "ERROR",
}

export interface IModel {
  id: number;
  user_id: string;
  name: string;
  training_images: string[];
  model_path: string | null;
  request_id: string | null;
  status: EModelStatus;
  error: any;
  is_deleted: boolean;
}
