class BaseError extends Error {
  private errorName: string;
  private errorDescription: string;
  private statusCode: number;
  private isOperationalError: boolean;
  private importanceType: string;
  private errorFieldName: string;

  constructor({
    errorName = "GeneralError",
    errorDescription = "No errorDescription Provided",
    statusCode = 500,
    isOperationalError = false,
    importanceType = "MEDIUM",
    errorFieldName = "unknown",
  } = {}) {
    super(errorDescription);
    Object.setPrototypeOf(this, new.target.prototype);

    this.errorName = errorName;
    this.statusCode = statusCode;
    this.isOperationalError = isOperationalError;
    this.errorDescription = errorDescription;
    this.importanceType = importanceType;
    this.errorFieldName = errorFieldName;
    Error.captureStackTrace(this);
  }
}
export { BaseError };
