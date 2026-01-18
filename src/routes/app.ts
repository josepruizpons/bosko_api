import express from "express";
import cors from "cors"
import bcrypt from 'bcrypt'
import cookieParser from "cookie-parser";
import "dotenv/config"; // carga automáticamente process.env
import { google_router } from "./google.routes";
import { bs_router } from "./beatstars.routes";
import { errorHandler } from "../utils";

import { prisma } from "../db"
import { require_session } from "../middlewares/session.middleware";
import { api_error400, api_error403 } from "../errors";

const app = express();
app.use(cookieParser());

const allowedOrigins = process.env.NODE_ENV === "production"
  ? ["https://bosko-9p6c.onrender.com"]
  : ["http://localhost:5173", 'http://localhost:5176'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get("/health", async (_req, res) => {
  await prisma.$connect();
  console.log('DB connected');
  // const allUsers = await prisma.users.findMany()
  // console.log('All users:', JSON.stringify(allUsers, null, 2))
  res.json({ status: "ok" });
});


// res.cookie("session_id", sessionId, {
//   httpOnly: true,
//   secure: true,      // true en prod
//   sameSite: "lax",   // o "strict"
//   maxAge: 1000 * 60 * 60 * 24,
// });
//
app.post('/login', async (req, res) => {
  const { email, password } = req.body ?? { email: undefined, password: undefined }
  if (
    typeof email != 'string'
    || typeof password != 'string'
  ) api_error400()

  console.log({email, password})
  const user = await prisma.users.findFirst({
    where: {
      email,
    }
  })
  console.log({user})

  if (user === null) {
    return api_error403('Invalid email')
  }
  const valid_password = await bcrypt.compare(password, user.password);
  if (!valid_password) {
    return api_error403('Invalid password')
  }

  res.cookie("session_id", user.id, {
    httpOnly: true,
    secure: true,      // true en prod
    sameSite: "lax",   // o "strict"
    maxAge: 1000 * 60 * 60 * 24,
  });

  return res.status(204).send()
})

const api_router = express.Router()
app.use('/api', api_router)
api_router.use(require_session)
api_router.get("/health", async (_req, res) => {
  await prisma.$connect();
  console.log('DB connected');
  // const allUsers = await prisma.users.findMany()
  // console.log('All users:', JSON.stringify(allUsers, null, 2))
  res.json({ status: "ok" });
});

api_router.use('/bs', bs_router)
api_router.use('/google', google_router)

app.use(errorHandler);

export default app;
