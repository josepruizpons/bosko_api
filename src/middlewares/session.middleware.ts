import { Request, Response, NextFunction } from "express";
import { ApiError } from "../errors";

export function validate_session(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!req.session.userId) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'No active session'));
  }

  next();
}
