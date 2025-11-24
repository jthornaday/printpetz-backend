import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";

import { IUser } from "./user";

interface CustomResponse extends ExpressResponse {
  customErrorResponse: (options?: {
    statusCode?: number;
    message?: string;
  }) => ExpressResponse;
  dataCreateSuccess: (options?: {
    message?: string;
    data?: object;
  }) => ExpressResponse;
  dataUpdateSuccess: (options?: {
    message?: string;
    data?: object;
  }) => ExpressResponse;
  dataDeleteSuccess: (options?: {
    message?: string;
    data?: object;
  }) => ExpressResponse;
  dataFetchSuccess: (options?: {
    data?: object;
    message?: string;
  }) => ExpressResponse;
  serverError: (options?: { message?: string }) => ExpressResponse;
  validationError: (options?: { message?: string }) => ExpressResponse;
}

interface CustomRequest extends ExpressRequest {
  user?: IUser;
  rawbody: string | Buffer;
}

export { CustomRequest, CustomResponse };
