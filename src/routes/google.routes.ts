import express from 'express'
import { google } from 'googleapis';
import { api_error400 } from '../errors';
import multer from 'multer'
import { buffer_to_stream, generate_video, get_current_user } from '../utils';
import { get_google_client } from '../google_auth';
import { db } from '../db';
import { CONNECTION_TYPES } from '../constants';


const upload = multer({ storage: multer.memoryStorage() }) // todo en memoria
export const google_router = express.Router();

// Ruta GET /google
google_router.get('/connect', async (req, res) => {
  const user = await get_current_user(req)
  const google_client = await get_google_client(user.id)

  const scopes = [
    // "https://www.googleapis.com/auth/youtube.upload",
    'https://www.googleapis.com/auth/youtube',
  ];

  const url = google_client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });

  res.json({
  })
  url
});

// Ruta GET /google/auth
google_router.get('/auth_callback', async (req, res) => {
  const user = await get_current_user(req)
  const google_client = await get_google_client(user.id)
  const code = req.query.code;

  if (code === undefined || typeof code !== 'string') {
    api_error400('Invalid code')
    return
  }

  //WARN: check if session applies to this endpoint
  const { tokens } = await google_client.getToken(code);
  const updatedOAuth = await db.oauth.updateMany({
    where: {
      id_user: user.id,
      connection_type: CONNECTION_TYPES.YOUTUBE,
    },
    data: {
      refresh_token: tokens.refresh_token ?? '',
    },
  });

  console.log(updatedOAuth);
  console.log({ tokens })
  google_client.setCredentials(tokens);
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
    const user = await get_current_user(req)
    const google_client = await get_google_client(user.id)

    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] }
      const bs_url: string = req.body.bs_url
      const name: string = req.body.name
      const publish_at: string | null = req.body.publish_at ?? null

      if (typeof bs_url !== 'string') api_error400('Invalid bs_url')
      if (typeof name !== 'string') api_error400('Invalid name')

      const publish_date = publish_at === null ? null : new Date(publish_at)
      if (publish_date !== null && isNaN(publish_date.getTime())) {
        return api_error400('Invalid publish_at date')
      }

      if (!files || !files['audio'] || !files['thumbnail']) {
        return res.status(400).json({ success: false, message: 'Faltan archivos' })
      }

      const audioBuffer = files['audio'][0].buffer
      const thumbBuffer = files['thumbnail'][0].buffer

      // Generar video
      const videoBuffer = await generate_video(audioBuffer, thumbBuffer)
      console.log('Video generated: ' + name)

      // Subir a YouTube
      const youtube = google.youtube({ version: 'v3', auth: google_client })

      console.log({ publish_date: publish_date?.toISOString() })

      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: name,
            description: `get your license: ${bs_url}



If you want to make profit with your music (upload your song to streaming services for example), you must purchase a license that is suitable for yourself before releasing your song. Regardless if you've purchased a license or not, you can't register your song on BMI/ASCAP/WIPO/OMPI or any worldwide copyright organization or any other Content ID system unless you have acquired an Exclusive license.`
          },
          status: {
            privacyStatus: 'private',
            publishAt: publish_date?.toISOString() ?? null
          },
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
