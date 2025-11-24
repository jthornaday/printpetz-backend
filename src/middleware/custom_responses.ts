import { HttpStatusCodes } from "@/constants/http_status_code";

/**
 * @typedef {Object} ResponseOptions
 * @property {string} [defaultMessage=""] - Default message to be used in the response.
 * @property {any} [defaultData=null] - Default data to be used in the response.
 * @property {number} [statusCode=500] - HTTP status code for the response.
 * @property {boolean} [defaultIsSuccess=false] - Default success status for the response.
 */
function responseTypeFactory({
  defaultMessage = "",
  defaultData = null,
  statusCode = HttpStatusCodes.INTERNAL_SERVER,
  defaultIsSuccess = false,
} = {}) {
  return function ({
    message = defaultMessage,
    data = defaultData,
    isSuccess = defaultIsSuccess,
  } = {}) {
    return this.status(statusCode).json({
      success: isSuccess,
      message: message,
      data: data,
    });
  };
}

const customResponses = {
  customErrorResponse: function (
    options = {
      statusCode: HttpStatusCodes.INTERNAL_SERVER,
      message: "",
    },
  ) {
    const { statusCode, message } = options;
    return responseTypeFactory({
      defaultIsSuccess: false,
      defaultMessage: message || "Some problem occurred",
      statusCode: statusCode,
    }).call(this); // bind `this` to `res`
  },

  dataCreateSuccess: responseTypeFactory({
    defaultIsSuccess: true,
    defaultMessage: "Data Created Successfully",
    statusCode: HttpStatusCodes.CREATE,
  }),

  dataUpdateSuccess: responseTypeFactory({
    defaultIsSuccess: true,
    defaultMessage: "Data Updated Successfully",
    statusCode: HttpStatusCodes.OK,
  }),

  dataDeleteSuccess: responseTypeFactory({
    defaultIsSuccess: true,
    defaultMessage: "Data Deleted Successfully",
    statusCode: HttpStatusCodes.OK,
  }),

  dataFetchSuccess: responseTypeFactory({
    defaultIsSuccess: true,
    defaultMessage: "Data Fetched Successfully",
    statusCode: HttpStatusCodes.OK,
  }),

  serverError: responseTypeFactory({
    defaultIsSuccess: false,
    defaultMessage: "Server Error",
    statusCode: HttpStatusCodes.INTERNAL_SERVER,
  }),

  validationError: responseTypeFactory({
    defaultIsSuccess: false,
    defaultMessage: "Validation Error",
    statusCode: HttpStatusCodes.BAD_REQUEST,
  }),
};

export default (req, res, next) => {
  Object.keys(customResponses).forEach((key) => {
    res[key] = customResponses[key].bind(res);
  });
  next();
};
