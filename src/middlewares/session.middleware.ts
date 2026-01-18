import { Request, Response, NextFunction } from "express";

export function require_session(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    return res.status(401).json({
      error: "No active session",
    });
  }

  // opcional: adjuntar a req para usar luego
  (req as any).sessionId = sessionId;

  next();
}
