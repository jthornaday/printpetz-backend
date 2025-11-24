import { HttpStatusCodes } from "../../constants/http_status_code";
import { BaseError } from "./baseErrors";

function errorTypeFactory({
  defaultErrorName = "",
  defaultStatusCode = HttpStatusCodes.OK,
  defaultErrorDescription = "",
} = {}) {
  return function ({
    errorName = defaultErrorName,
    statusCode = defaultStatusCode,
    errorDescription = defaultErrorDescription,
  } = {}) {
    return new BaseError({
      errorName: errorName,
      statusCode: statusCode,
      errorDescription: errorDescription,
    });
  };
}

const errorResponse = {
  Api400Error: errorTypeFactory({
    defaultErrorName: "BAD_REQUEST",
    defaultStatusCode: HttpStatusCodes.BAD_REQUEST,
    defaultErrorDescription: "Bad Request",
  }),

  Api401Error: errorTypeFactory({
    defaultErrorName: "UNAUTHORIZED",
    defaultStatusCode: HttpStatusCodes.UNAUTHORIZED,
    defaultErrorDescription: "This operation is unauthorized",
  }),

  Api403Error: errorTypeFactory({
    defaultErrorName: "FORBIDDEN",
    defaultStatusCode: HttpStatusCodes.FORBIDDEN,
    defaultErrorDescription: "This operation is forbidden",
  }),

  Api404Error: errorTypeFactory({
    defaultErrorName: "NOT_FOUND",
    defaultStatusCode: HttpStatusCodes.NOT_FOUND,
    defaultErrorDescription: "Requested Data is Not Found",
  }),

  Api500Error: errorTypeFactory({
    defaultErrorName: "INTERNAL_SERVER",
    defaultStatusCode: HttpStatusCodes.INTERNAL_SERVER,
    defaultErrorDescription: "Internal Server Error",
  }),

  Api409Error: errorTypeFactory({
    defaultErrorName: "DATA_EXIST",
    defaultStatusCode: HttpStatusCodes.ALREADY_EXIST,
    defaultErrorDescription: "Data already exist",
  }),

  idNotFoundError: errorTypeFactory({
    defaultErrorName: "BAD_REQUEST",
    defaultStatusCode: HttpStatusCodes.BAD_REQUEST,
    defaultErrorDescription: "Id not Found",
  }),

  missingApiKey: errorTypeFactory({
    defaultErrorName: "API_KEY_WRONG",
    defaultStatusCode: HttpStatusCodes.UNAUTHORIZED,
    defaultErrorDescription: "Api key is wrong or not found",
  }),
};

export default errorResponse;
