import express from "express";
import session from 'express-session';
import cors from "cors"
import cookieParser from "cookie-parser";
import "dotenv/config";
import { google } from 'googleapis';
import { google_router } from "./google.routes";
import { bs_router } from "./beatstars.routes";
import { tracks_router } from "./tracks.router";
import { assets_router } from "./assets.router";
import { errorHandler, generate_id, get_current_user } from "../utils";
import { db } from "../db"
import { auth_router } from "./auth.routes";
import { user_router } from "./user.routes";
import { profiles_router, bs_connect_token_handler } from "./profiles.router";
import { validate_session } from "../middlewares/session.middleware";
import { api_error400, api_error500 } from "../errors";
import { PLATFORMS } from "../constants";

const app = express();
app.use(cookieParser());

const allowedOrigins = process.env.NODE_ENV === "production"
  ? [
    "https://bosko-9p6c.onrender.com",
    'https://bosko-api-ppse.onrender.com',
    'https://boskofiles.com',
    'https://dev.boskofiles.com',
    'https://www.boskofiles.com',
    'https://studio.beatstars.com',
  ]
  : [
    "http://localhost:5173",
    'http://localhost:5176',
    "https://localhost:5173",
    "https://localhost:5174",
    'https://localhost:5176',
    'https://studio.beatstars.com',
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

// Ruta GET /google/auth_callback
app.get('/google/auth_callback', async (req, res) => {
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

  const code = req.query.code
  if (!code || typeof code !== 'string') return api_error400('Invalid code')

  const client_id = process.env.GOOGLE_CLIENT_ID
  const client_secret = process.env.GOOGLE_CLIENT_SECRET
  if (!client_id || !client_secret) return api_error500('Google OAuth credentials not configured')

  const callback_endpoint = process.env.NODE_ENV === 'production'
    ? `${process.env.PROD_HOSTNAME}/google/auth_callback`
    : 'https://localhost:3000/google/auth_callback'

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, callback_endpoint)
  const { tokens } = await oauth2Client.getToken(code)
  const refresh_token = tokens.refresh_token ?? ''

  const existing = await db.profile_connections.findFirst({
    where: { id_profile, platform: PLATFORMS.YOUTUBE },
  })

  if (existing) {
    await db.oauth.update({
      where: { id: existing.id_oauth },
      data: { refresh_token },
    })
  } else {
    const oauth = await db.oauth.create({
      data: {
        client_id,
        client_secret,
        refresh_token,
        id_user: userId,
        connection_type: PLATFORMS.YOUTUBE,
      },
    })
    await db.profile_connections.create({
      data: {
        id: generate_id(),
        id_profile,
        platform: PLATFORMS.YOUTUBE,
        id_oauth: oauth.id,
        meta: {},
      },
    })
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bosko</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&display=swap" rel="stylesheet" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        background-color: #1d2021;
        color: #ebdbb2;
        font-family: 'Google Sans', system-ui, -apple-system, sans-serif;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
      }
      .card {
        background-color: #282828;
        border: 1px solid #3c3836;
        border-radius: 1rem;
        padding: 2rem 2.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        text-align: center;
        animation: scale-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes scale-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      .icon { font-size: 1.5rem; color: #89b482; }
      .title { font-size: 1rem; font-weight: 600; color: #ebdbb2; }
      .subtitle { color: #928374; font-size: 0.8rem; }
      .spinner {
        width: 18px; height: 18px;
        border: 2px solid #3c3836;
        border-top-color: #89b482;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="spinner" id="spinner"></div>
      <div class="title">YouTube connected</div>
      <div class="subtitle" id="subtitle">Closing window...</div>
    </div>
    <script>
      window.onload = function() {
        if (window.opener) {
          window.opener.postMessage({ type: "google-auth-success" }, "*");
        }
        window.close();
        setTimeout(function() {
          document.getElementById('spinner').classList.add('hidden');
          document.getElementById('subtitle').textContent = 'You can close this window.';
        }, 800);
      };
    </script>
  </body>
</html>`);
});


app.use('/auth', auth_router)

// Public BeatStars token endpoint — authenticated via one-time connect_token, not session
app.post('/api/profiles/:id/connections/beatstars/token', express.json(), bs_connect_token_handler)

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
