import { NextFunction } from "express";

import { CustomRequest, CustomResponse } from "@/types/interfaces";

type ExpressMiddleware = (
  req: CustomRequest,
  res: CustomResponse,
  next: NextFunction,
) => void | Promise<void>;

class AsyncHandler {
  static handle(func: ExpressMiddleware) {
    return async (
      req: CustomRequest,
      res: CustomResponse,
      next: NextFunction,
    ) => {
      try {
        await func(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }
}

export default AsyncHandler;
