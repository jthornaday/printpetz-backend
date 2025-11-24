class BaseError extends Error {
  errorName: string;
  errorDescription: string;
  statusCode: number;
  isOperationalError: boolean;

  constructor({
    errorName = "Error",
    errorDescription = "No error description provided",
    statusCode = 500,
    isOperationalError = false,
  } = {}) {
    super(errorDescription);
    Object.setPrototypeOf(this, new.target.prototype);

    this.errorName = errorName;
    this.statusCode = statusCode;
    this.isOperationalError = isOperationalError;
    this.errorDescription = errorDescription;
    Error.captureStackTrace(this);
  }
}

export { BaseError };
