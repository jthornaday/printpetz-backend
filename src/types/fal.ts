import { QwenImageOutput } from "@fal-ai/client/endpoints";

interface IFalErrorResponse {
  error: string;
  request_id: string;
  payload: {
    details: Record<string, any>[];
  };
  status: "ERROR";
}

interface IFalSuccessResponse<T> {
  error: null;
  payload: T;
  request_id: string;
  status: "OK";
}

interface IFalModelTrainingResponsePayload {
  lora_file: {
    url: string;
  };
}

export type TFalModelTrainingResponse =
  | IFalSuccessResponse<IFalModelTrainingResponsePayload>
  | IFalErrorResponse;

export type TFalImageGenerationResponse =
  | IFalSuccessResponse<QwenImageOutput>
  | IFalErrorResponse;
