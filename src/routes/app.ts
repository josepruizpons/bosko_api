import express from "express";
import session from 'express-session';
import cors from "cors"
import cookieParser from "cookie-parser";
import "dotenv/config"; // carga automáticamente process.env
import { google_router } from "./google.routes";
import { bs_router } from "./beatstars.routes";
import { errorHandler } from "../utils";

import { db } from "../db"
import { auth_router } from "./auth.routes";
import { validate_session } from "../middlewares/session.middleware";

const app = express();
app.use(cookieParser());

const allowedOrigins = process.env.NODE_ENV === "production"
  ? [
    "https://bosko-9p6c.onrender.com",
    'https://bosko-api-ppse.onrender.com'
  ]
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

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not defined');
}

app.set('trust proxy', 1);
app.use(
  session({
    name: 'bosko_session',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use('/auth', auth_router)

const api_router = express.Router()
api_router.use(validate_session)

api_router.get('/check', async (req, res) => {
  const sessionId = req.session.userId
  console.log(req.cookies)

  if (!sessionId) {
    return res.status(401).json({
      error: "No active session",
    });
  }

  return res.status(204).send()
})
api_router.use('/bs', bs_router)
api_router.use('/google', google_router)

app.use('/api', api_router)
app.use(errorHandler);

export default app;
