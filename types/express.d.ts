import { Request } from "express";
import 'express-session';

declare module "express-serve-static-core" {
  interface Request {
    id_user?: string;
    sessionId?: string;
  }
}


declare module 'express-session' {
  interface SessionData {
    userId: number; // o string, según cómo guardes el id
  }
}
