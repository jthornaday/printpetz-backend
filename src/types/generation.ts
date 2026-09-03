export enum EGenerationStatus {
  PENDING = "PENDING",
  GENERATING = "GENERATING",
  COMPLETED = "COMPLETED",
  ERROR = "ERROR",
}

export interface IGeneration {
  id: number;
  user_id: string;
  group_id: number;
  style_id: number;
  model_id: number;
  prompt: string;
  image: string | null;
  request_id: string | null;
  status: EGenerationStatus;
  error: any;
  seed: number | null;
}
