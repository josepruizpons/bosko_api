import express from 'express'
import { google } from 'googleapis';
import type { GaxiosResponseWithHTTP2 } from 'googleapis-common';
import type { youtube_v3 } from 'googleapis';
import { api_error400, api_error403, api_error404, api_error429, api_error500 } from '../errors';
import { apply_crop_to_buffer, asyncHandler, buffer_to_stream, generate_video, get_current_user, get_profile, is_youtube_quota_error, youtubeUrl } from '../utils';
import { get_google_client } from '../google_auth';
import { db, track_include } from '../db'
import { deleteFileFromS3, downloadFileFromS3, invokeVideoLambda, uploadBufferToS3 } from '../aws';
import { db_track_to_track } from '../mappers';
import { PLATFORMS, PROD_HOSTNAME } from '../constants';

export const google_router = express.Router();

google_router.get('/connect', async (req, res) => {
  const user = await get_current_user(req)
  const id_profile = req.query.id_profile as string | undefined

  if (!id_profile) {
    return api_error400('Missing required query param: id_profile')
  }

  await get_profile(user.id, id_profile)

  const client_id = process.env.GOOGLE_CLIENT_ID
  const client_secret = process.env.GOOGLE_CLIENT_SECRET

  if (!client_id || !client_secret) {
    return api_error500('Google OAuth credentials not configured')
  }

  const callback_endpoint = process.env.NODE_ENV === 'production'
    ? `${PROD_HOSTNAME}/google/auth_callback`
    : 'https://localhost:3000/google/auth_callback'

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, callback_endpoint)

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube'],
    state: JSON.stringify({ userId: user.id, id_profile }),
  })

  res.json({ url })
});


google_router.post(
  '/upload-youtube',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)

    const id_track: string | null = req.body.id_track ?? null

    if (typeof id_track !== 'string') return api_error400('Invalid track')

    const track = await db.track.findUnique({
      where: { id: id_track }
    })

    if (track === null) return api_error404('Track not found')

    // Verificar que el track pertenece al usuario
    if (track.id_user !== user.id) {
      return api_error403('You do not have permission to upload this track')
    }

    if (!track.id_profile) {
      return api_error400('Track has no profile assigned')
    }

    const google_client = await get_google_client(track.id_profile)
    if (!google_client) {
      return api_error400('Profile has no YouTube connection')
    }

    // Leer descripción desde la conexión YouTube del perfil (con fallback hardcoded)
    const yt_connection = await db.profile_connections.findFirst({
      where: {
        id_profile: track.id_profile,
        platform: PLATFORMS.YOUTUBE,
      }
    })
    const yt_meta = (yt_connection?.meta ?? {}) as Record<string, any>
    const default_description = `get your license: ${track.beatstars_url}



If you want to make profit with your music (upload your song to streaming services for example), you must purchase a license that is suitable for yourself before releasing your song. Regardless if you've purchased a license or not, you can't register your song on BMI/ASCAP/WIPO/OMPI or any worldwide copyright organization or any other Content ID system unless you have acquired an Exclusive license.`
    const video_description: string = yt_meta.description
      ? yt_meta.description.replace('{bs_url}', track.beatstars_url ?? '')
      : default_description
    const yt_prefix: string = (yt_meta.name_prefix ?? '').trim()
    const yt_suffix: string = (yt_meta.name_suffix ?? '').trim()
    const track_title = [yt_prefix, track.name, yt_suffix].filter(Boolean).join(' ').slice(0, 100)

    // Idempotente: si ya fue subido, devolver URL existente
    if (track.yt_url) {
      return res.json({ success: true, yt_url: track.yt_url })
    }

    const publish_date = track.publish_at
    if (publish_date !== null && isNaN(publish_date.getTime())) {
      return api_error400('Invalid publish_at date')
    }

    let videoBuffer: Buffer | undefined;
    let videoS3Key: string | undefined;

    if (track.id_beat === null) {
      return api_error400('Track is missing id_beat')
    }

    if (track.id_thumbnail === null) {
      return api_error400('Track is missing id_thumbnail')
    }

    // Obtener assets de la base de datos
    const beatAsset = await db.asset.findUnique({
      where: { id: track.id_beat }
    });

    const thumbnailAsset = await db.asset.findUnique({
      where: { id: track.id_thumbnail }
    });

    if (!beatAsset?.s3_key) {
      return api_error400('Beat not found in S3');
    }

    if (!thumbnailAsset?.s3_key) {
      return api_error400('Thumbnail not found in S3');
    }

    const isProduction = process.env.NODE_ENV === 'production';

    // Leer setting yt_crop_thumbnail del perfil
    const profile_for_settings = await db.profiles.findUnique({ where: { id: track.id_profile } })
    const profile_settings = (profile_for_settings?.settings ?? {}) as Record<string, string>
    const yt_crop_thumbnail = profile_settings.yt_crop_thumbnail === 'true'

    // Determinar la S3 key del thumbnail a usar (original o cropeada temporalmente)
    let thumb_s3_key_for_video = thumbnailAsset.s3_key
    let temp_cropped_s3_key: string | undefined

    if (yt_crop_thumbnail) {
      const thumbBuffer = await downloadFileFromS3(thumbnailAsset.s3_key)
      const crop = thumbnailAsset.crop_data as { x: number; y: number; w: number; h: number } | null
      const croppedBuffer = await apply_crop_to_buffer(thumbBuffer, crop ?? undefined)
      // En producción, subir temporalmente a S3 para pasarlo a Lambda
      if (isProduction) {
        temp_cropped_s3_key = `thumbnails/tmp_yt_${Date.now()}_${thumbnailAsset.id}.png`
        await uploadBufferToS3(croppedBuffer, temp_cropped_s3_key, 'image/png')
        thumb_s3_key_for_video = temp_cropped_s3_key
      } else {
        // En desarrollo, generamos el vídeo directamente con el buffer cropeado
        const audioBuffer = await downloadFileFromS3(beatAsset.s3_key)
        videoBuffer = await generate_video(audioBuffer, croppedBuffer)
        console.log('Video generated locally with cropped thumbnail: ' + track_title)
      }
    }

    if (isProduction) {
      // Producción: usar Lambda para generar el vídeo
      console.log('Using Lambda for video generation in production');

      videoS3Key = await invokeVideoLambda(
        beatAsset.s3_key,
        thumb_s3_key_for_video,
        track_title
      );

      console.log('Lambda returned S3 key:', videoS3Key);

      videoBuffer = await downloadFileFromS3(videoS3Key);

      console.log('Video downloaded from S3: ' + track_title);
    } else if (!videoBuffer) {
      // Desarrollo sin crop YT: descargar de S3 y generar vídeo localmente
      console.log('Development: Downloading assets from S3 for local video generation');

      const audioBuffer = await downloadFileFromS3(beatAsset.s3_key);
      const thumbBuffer = await downloadFileFromS3(thumbnailAsset.s3_key);

      videoBuffer = await generate_video(audioBuffer, thumbBuffer)
      console.log('Video generated locally: ' + track_title)
    }

    // Subir a YouTube (capturar errores de quota)
    let yt_response;
    try {
      const youtube = google.youtube({ version: 'v3', auth: google_client })
      yt_response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: track_title,
            description: video_description
          },
          status: {
            privacyStatus: 'private',
            publishAt: publish_date?.toISOString() ?? null
          },
        },
        media: { body: buffer_to_stream(videoBuffer!) },
      })
    } catch (err) {
      if (is_youtube_quota_error(err)) {
        return api_error429('YouTube daily upload limit reached. Try again tomorrow.')
      }
      throw err
    }

    const yt_id = yt_response.data.id ?? null
    if (!yt_id) {
      return api_error500('YT id not generated')
    }

    const db_track = await db.track.update({
      where: { id: track.id },
      data: { yt_url: youtubeUrl(yt_id) },
      include: track_include
    })

    // Eliminar assets de S3 tras subida exitosa a YouTube
    if (beatAsset?.s3_key) {
      try {
        await deleteFileFromS3(beatAsset.s3_key);
        console.log('Beat deleted from S3:', beatAsset.s3_key);
      } catch (deleteErr) {
        console.error('Error deleting beat from S3:', deleteErr);
      }
    }

    if (thumbnailAsset?.s3_key) {
      try {
        await deleteFileFromS3(thumbnailAsset.s3_key);
        console.log('Thumbnail deleted from S3:', thumbnailAsset.s3_key);
      } catch (deleteErr) {
        console.error('Error deleting thumbnail from S3:', deleteErr);
      }
    }

    // Eliminar vídeo temporal de S3 (solo en producción)
    if (isProduction && videoS3Key) {
      try {
        await deleteFileFromS3(videoS3Key);
        console.log('Temporary video deleted from S3:', videoS3Key);
      } catch (deleteErr) {
        console.error('Error deleting video from S3:', deleteErr);
      }
    }

    // Eliminar thumbnail cropeado temporal de S3 (solo en producción si se generó)
    if (isProduction && temp_cropped_s3_key) {
      try {
        await deleteFileFromS3(temp_cropped_s3_key)
        console.log('Temporary cropped thumbnail deleted from S3:', temp_cropped_s3_key)
      } catch (deleteErr) {
        console.error('Error deleting temp cropped thumbnail from S3:', deleteErr)
      }
    }

    const updated_track = await db_track_to_track(db_track)
    res.json(updated_track)
  })
)

// GET /api/google/last-scheduled?id_profile=<id>
google_router.get('/last-scheduled',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id_profile = req.query.id_profile as string | undefined

    if (!id_profile) return api_error400('Missing required query param: id_profile')

    const profile = await get_profile(user.id, id_profile)

    // Leer intervalo del perfil (mínimo 1) — necesario en todos los casos
    const interval = Math.max(1, parseInt((profile.settings as Record<string, string>)?.publish_interval_days ?? '1') || 1)

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    // Helper: next_expected cuando no hay last_scheduled → hoy + interval
    const next_from_today = () => {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() + interval)
      return d
    }

    const google_client = await get_google_client(id_profile)
    if (!google_client) {
      return res.json({ id_profile, profile_name: profile.name, last_scheduled: null, next_expected: next_from_today().toISOString() })
    }
    const youtube = google.youtube({ version: 'v3', auth: google_client })

    // Paso 1: obtener uploadsPlaylistId del canal
    const channelRes = await youtube.channels.list({
      part: ['contentDetails'],
      mine: true,
    })
    const uploadsPlaylistId =
      channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) {
      return res.json({ id_profile, profile_name: profile.name, last_scheduled: null, next_expected: next_from_today().toISOString() })
    }

    // Paso 2: recopilar video IDs de la playlist de uploads (hasta 200)
    const videoIds: string[] = []
    let nextPageToken: string | undefined = undefined
    let hasMore = true
    while (hasMore && videoIds.length < 200) {
      const playlistRes: GaxiosResponseWithHTTP2<youtube_v3.Schema$PlaylistItemListResponse> =
        await youtube.playlistItems.list({
        part: ['snippet'],
        playlistId: uploadsPlaylistId,
        maxResults: 50,
        pageToken: nextPageToken,
      })
      for (const item of playlistRes.data.items ?? []) {
        const vid = item.snippet?.resourceId?.videoId
        if (vid) videoIds.push(vid)
      }
      nextPageToken = playlistRes.data.nextPageToken ?? undefined
      hasMore = !!nextPageToken
    }

    if (videoIds.length === 0) {
      return res.json({ id_profile, profile_name: profile.name, last_scheduled: null, next_expected: next_from_today().toISOString() })
    }

    // Paso 3: obtener status + snippet en batches de 50
    const toUtcDateString = (d: Date) => d.toISOString().slice(0, 10) // "YYYY-MM-DD"
    const coveredDays = new Set<string>()
    const allDates: Date[] = []

    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50)
      const videosRes = await youtube.videos.list({
        part: ['status', 'snippet'],
        id: batch,
      })
      for (const video of videosRes.data.items ?? []) {
        const { privacyStatus, publishAt } = video.status ?? {}
        const publishedAt = video.snippet?.publishedAt
        let date: Date | null = null
        if (privacyStatus === 'private' && publishAt) {
          date = new Date(publishAt)
        } else if (privacyStatus === 'public' && publishedAt) {
          date = new Date(publishedAt)
        }
        if (date) {
          coveredDays.add(toUtcDateString(date))
          allDates.push(date)
        }
      }
    }

    // Sin vídeos con fecha útil → null
    if (allDates.length === 0) {
      return res.json({ id_profile, profile_name: profile.name, last_scheduled: null, next_expected: next_from_today().toISOString() })
    }

    // Fecha base: el último vídeo existente
    const lastDate = new Date(Math.max(...allDates.map(d => d.getTime())))
    lastDate.setUTCHours(0, 0, 0, 0)

    // Recorrer slots (lastDate + N, + 2N, ...) mientras estén cubiertos
    let lastConsecutive: Date | null = null
    let slotBase = new Date(lastDate)

    while (true) {
      const nextSlot = new Date(slotBase)
      nextSlot.setUTCDate(nextSlot.getUTCDate() + interval)

      // Ignorar slots que ya han pasado (anteriores o iguales a hoy)
      if (nextSlot <= today) {
        slotBase = nextSlot
        continue
      }

      if (coveredDays.has(toUtcDateString(nextSlot))) {
        lastConsecutive = nextSlot
        slotBase = nextSlot
      } else {
        break
      }
    }

    // Fallback: si no hay cadena desde el primer slot futuro, devolver el último vídeo existente
    const lastScheduled = lastConsecutive ?? lastDate

    // next_expected: el siguiente slot vacío tras last_scheduled
    const nextExpected = new Date(lastScheduled)
    nextExpected.setUTCDate(nextExpected.getUTCDate() + interval)

    res.json({
      id_profile,
      profile_name: profile.name,
      last_scheduled: lastScheduled.toISOString(),
      next_expected: nextExpected.toISOString(),
    })
  })
)
