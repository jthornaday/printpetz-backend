export enum EModelStatus {
  PENDING = "PENDING",
  TRAINING = "TRAINING",
  COMPLETED = "COMPLETED",
  ERROR = "ERROR",
}

export interface IStyle {
  id: number;
  name: string;
  category: string;
  image: string;
  prompts: string[];
}
