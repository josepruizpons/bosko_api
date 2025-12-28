import express from 'express'
import { google } from 'googleapis';

export const google_router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "http://localhost:3000/oauth2callback"
);

// Ruta GET /google
google_router.get('/', (req, res) => {

  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "http://localhost:3000/oauth2callback"
  );

  const scopes = ["https://www.googleapis.com/auth/youtube.upload"];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });

  console.log("Autoriza aquí:", url);
});

// Ruta GET /google/auth
google_router.get('/auth', async (req, res) => {
  const code = req.query.code;

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  // Guarda refresh_token en BD

  res.send("Autorización completada ✅");
});

