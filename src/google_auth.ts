import { google } from 'googleapis'

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CID,
  process.env.GOOGLE_CS,
  'https://localhost:3000/google/auth_callback'
)

// Establece refresh token
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_RT,
})


