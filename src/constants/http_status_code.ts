class HttpStatusCodes {
  static CREATE = 201;

  static OK = 200;
  static NO_CONTENT = 204;

  static FOUND = 302; // FOUND

  static BAD_REQUEST = 400;
  static UNAUTHORIZED = 401;
  static FORBIDDEN = 403;
  static NOT_FOUND = 404;
  static ALREADY_EXIST = 409; // Conflict
  static UNPROCESSABLE_REQUEST = 422; // Unprocessable Entity
  static APP_UPDATE_NEEDED = 426;

  static INTERNAL_SERVER = 500;
}

export { HttpStatusCodes };
