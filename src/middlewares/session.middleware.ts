import { Request, Response, NextFunction } from "express";

export function require_session(
  req: Request,
  res: Response,
  next: NextFunction
) {

  const sessionId = req.cookies?.bosko_cookie;
  console.log({sessionId})

  if (!sessionId) {
    return res.status(401).json({
      error: "No active session",
    });
  }

  // opcional: adjuntar a req para usar luego
  req.id_user = sessionId;

  next();
}
