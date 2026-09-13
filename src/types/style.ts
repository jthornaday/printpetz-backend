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
  base_prompt: string;
  // jsonb. Typed `unknown` on purpose: the column holds whatever was written to
  // it, and the prompt path validates rather than trusts. See prompt_variants.
  variants: unknown;
}
