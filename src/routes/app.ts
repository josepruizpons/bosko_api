import express from "express";
import session from 'express-session';
import cors from "cors"
import cookieParser from "cookie-parser";
import "dotenv/config"; // carga automáticamente process.env
import { google_router } from "./google.routes";
import { bs_router } from "./beatstars.routes";
import { tracks_router } from "./tracks.router";
import { assets_router } from "./assets.router";
import { errorHandler, get_current_user } from "../utils";

import { db } from "../db"
import { auth_router } from "./auth.routes";
import { user_router } from "./user.routes";
import { profiles_router } from "./profiles.router";
import { validate_session } from "../middlewares/session.middleware";
import { get_google_client } from "../google_auth";
import { api_error400 } from "../errors";
import { PLATFORMS } from "../constants";

const app = express();
app.use(cookieParser());

const allowedOrigins = process.env.NODE_ENV === "production"
  ? [
    "https://bosko-9p6c.onrender.com",
    'https://bosko-api-ppse.onrender.com',
    'https://boskofiles.com',
    'https://www.boskofiles.com',
  ]
  : [
    "http://localhost:5173",
    'http://localhost:5176',
    "https://localhost:5173",
    "https://localhost:5174",
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
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

// Ruta GET /google/auth
app.get('/google/auth_callback', async (req, res) => {
  // State is now JSON: { userId, id_profile }
  let userId: number
  let id_profile: string
  try {
    const state = JSON.parse(req.query.state as string)
    userId = state.userId
    id_profile = state.id_profile
  } catch {
    return api_error400('Invalid state')
  }

  if (!userId || !id_profile) return api_error400('Invalid state: missing userId or id_profile')

  req.session.userId = userId
  const user = await get_current_user(req)
  const google_client = await get_google_client(id_profile)
  const code = req.query.code;

  if (code === undefined || typeof code !== 'string') {
    api_error400('Invalid code')
    return
  }

  //WARN: check if session applies to this endpoint
  const { tokens } = await google_client.getToken(code);

  // Update refresh token via profile_connections → oauth
  const connection = await db.profile_connections.findFirst({
    where: {
      id_profile,
      platform: PLATFORMS.YOUTUBE,
    }
  })

  if (connection) {
    await db.oauth.update({
      where: { id: connection.id_oauth },
      data: {
        refresh_token: tokens.refresh_token ?? '',
      },
    });
  }

  console.log({ tokens })
  google_client.setCredentials(tokens);
  // Guarda refresh_token en BD

  // RESPUESTA QUE CIERRA EL POPUP
  res.send(`
    <html>
      <body>
        <script>
          if (window.opener) {
            window.opener.postMessage(
              { type: "google-auth-success" },
              "${process.env.FRONTEND_URL}"
            );
          }
          window.close();
        </script>
        Autorización completada. Puedes cerrar esta ventana.
      </body>
    </html>
  `);
});


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
api_router.use('/tracks', tracks_router)
api_router.use('/assets', assets_router)
api_router.use('/user', user_router)
api_router.use('/profiles', profiles_router)

app.use('/api', api_router)
app.use(errorHandler);

export default app;
