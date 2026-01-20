import express from "express";
import cors from "cors"
import cookieParser from "cookie-parser";
import "dotenv/config"; // carga automáticamente process.env
import { google_router } from "./google.routes";
import { bs_router } from "./beatstars.routes";
import { errorHandler } from "../utils";

import { db } from "../db"
import { require_session } from "../middlewares/session.middleware";
import { auth_router } from "./auth.routes";

const app = express();
app.use(cookieParser());

const allowedOrigins = process.env.NODE_ENV === "production"
  ? ["https://bosko-9p6c.onrender.com"]
  : [
    "http://localhost:5173",
    'http://localhost:5176',
    "https://localhost:5173",
    'https://localhost:5176',
  ];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get("/health", async (_req, res) => {
  await db.$connect();
  console.log('DB connected');
  res.json({ status: "ok" });
});

app.use('/auth', auth_router)

const api_router = express.Router()
app.use('/api', api_router)
api_router.use(require_session)
api_router.get("/health", async (_req, res) => {
  await db.$connect();
  console.log('DB connected');
  res.json({ status: "ok" });
});

api_router.use('/bs', bs_router)
api_router.use('/google', google_router)

app.use(errorHandler);

export default app;
