import express from 'express'
import { google } from 'googleapis';
import { api_error400 } from '../errors';
import multer from 'multer'
import { buffer_to_stream, generate_video } from '../utils';
import { oauth2Client } from '../google_auth';


const upload = multer({ storage: multer.memoryStorage() }) // todo en memoria
export const google_router = express.Router();

// Ruta GET /google
google_router.get('/connect', (_, res) => {

  const scopes = [
    // "https://www.googleapis.com/auth/youtube.upload",
    'https://www.googleapis.com/auth/youtube',
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });

  res.json({
    url
  })
});

// Ruta GET /google/auth
google_router.get('/auth_callback', async (req, res) => {
  const code = req.query.code;

  if (code === undefined || typeof code !== 'string') {
    api_error400('Invalid code')
    return
  }

  const { tokens } = await oauth2Client.getToken(code);
  console.log({ tokens })
  oauth2Client.setCredentials(tokens);
  // Guarda refresh_token en BD

  res.send("Autorización completada ✅");
});




google_router.post(
  '/upload-youtube',
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] }
      const bs_url: string = req.body.bs_url

      if(typeof bs_url !== 'string') api_error400('Invalid bs_url')

      if (!files || !files['audio'] || !files['thumbnail']) {
        return res.status(400).json({ success: false, message: 'Faltan archivos' })
      }

      const audioBuffer = files['audio'][0].buffer
      const thumbBuffer = files['thumbnail'][0].buffer

      // Generar video
      const videoBuffer = await generate_video(audioBuffer, thumbBuffer)
      console.log({creds:oauth2Client.credentials})

      // Subir a YouTube
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client })

      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: { title: 'bosko v1', description: `Beatstars: ${bs_url}` },
          status: { privacyStatus: 'private' },
        },
        media: { body: buffer_to_stream(videoBuffer) },
      })

      res.json({ success: true, videoId: response.data.id })
    } catch (err) {
      console.error(err)
      res.status(500).json({ success: false, error: err })
    }
  }
)
