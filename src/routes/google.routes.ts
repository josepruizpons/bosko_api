import express from 'express'
import { google } from 'googleapis';
import type { GaxiosResponseWithHTTP2 } from 'googleapis-common';
import type { youtube_v3 } from 'googleapis';
import { api_error400, api_error500 } from '../errors';
import { asyncHandler, buffer_to_stream, generate_video, get_current_user, get_profile, youtubeUrl } from '../utils';
import { get_google_client } from '../google_auth';
import { db, track_include } from '../db'
import { deleteFileFromS3, downloadFileFromS3, invokeVideoLambda } from '../aws';
import { db_track_to_track } from '../mappers';
import { PLATFORMS } from '../constants';

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
    ? `${process.env.PROD_HOSTNAME}/google/auth_callback`
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
  async (req, res) => {
    const user = await get_current_user(req)

    try {
      const id_track: string | null = req.body.id_track ?? null

      if (typeof id_track !== 'string') return api_error400('Invalid track')


      const track = await db.track.findUnique({
        where: { id: id_track }
      })

      if (track === null) return api_error400('Track not found')

      // Verify track belongs to user
      if (track.id_user !== user.id) {
        return api_error400('You do not have permission to upload this track')
      }

      if (!track.id_profile) {
        return api_error400('Track has no profile assigned')
      }

      const google_client = await get_google_client(track.id_profile)

      // Read description from profile's YouTube connection meta (with hardcoded fallback)
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

      // Idempotent: if already uploaded, return existing URL
      if (track.yt_url) {
        return res.json({ success: true, yt_url: track.yt_url })
      }

      const publish_date = track.publish_at
      if (publish_date !== null && isNaN(publish_date.getTime())) {
        return api_error400('Invalid publish_at date')
      }

      let videoBuffer: Buffer;
      let videoS3Key: string | undefined;

      if (track.id_beat === null) {
        return api_error400('Track is missing id_beat')
      }

      if (track.id_thumbnail === null) {
        return api_error400('Track is missing id_thumbnail')
      }

      // Get assets from database (both production and local)
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

      if (isProduction) {
        // Production: Use Lambda to generate video
        console.log('Using Lambda for video generation in production');

        // Invoke Lambda
        videoS3Key = await invokeVideoLambda(
          beatAsset.s3_key,
          thumbnailAsset.s3_key,
          track_title
        );

        console.log('Lambda returned S3 key:', videoS3Key);

        // Download video from S3 using SDK
        videoBuffer = await downloadFileFromS3(videoS3Key);

        console.log('Video downloaded from S3: ' + track_title);
      } else {
        // Development: Download from S3 and generate video locally
        console.log('Development: Downloading assets from S3 for local video generation');

        const audioBuffer = await downloadFileFromS3(beatAsset.s3_key);
        const thumbBuffer = await downloadFileFromS3(thumbnailAsset.s3_key);

        videoBuffer = await generate_video(audioBuffer, thumbBuffer)
        console.log('Video generated locally: ' + track_title)
      }

      // Subir a YouTube
      const youtube = google.youtube({ version: 'v3', auth: google_client })

      const response = await youtube.videos.insert({
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
        media: { body: buffer_to_stream(videoBuffer) },
      })

      const yt_id = response.data.id ?? null
      if(!yt_id){
        return api_error500('YT id not generated')
      }

      const db_track = await db.track.update({
        where: {id: track.id},
        data: { yt_url: youtubeUrl(yt_id)},
        include: track_include
      })

      // Delete beat and thumbnail assets from S3 after successful YouTube upload
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

      // Delete temporary video from S3 (production only)
      if (isProduction && videoS3Key) {
        try {
          await deleteFileFromS3(videoS3Key);
          console.log('Temporary video deleted from S3:', videoS3Key);
        } catch (deleteErr) {
          // Don't fail the entire operation if deletion fails
          console.error('Error deleting video from S3:', deleteErr);
        }
      }

      const updated_track = await db_track_to_track(db_track)
      res.json(updated_track)
    } catch (err) {
      console.error(err)
      res.status(500).json({ success: false, error: err })
    }
  }
)

// GET /api/google/last-scheduled?id_profile=<id>
google_router.get('/last-scheduled',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id_profile = req.query.id_profile as string | undefined

    if (!id_profile) return api_error400('Missing required query param: id_profile')

    const profile = await get_profile(user.id, id_profile)
    const google_client = await get_google_client(id_profile)
    const youtube = google.youtube({ version: 'v3', auth: google_client })

    // Paso 1: obtener uploadsPlaylistId del canal
    const channelRes = await youtube.channels.list({
      part: ['contentDetails'],
      mine: true,
    })
    const uploadsPlaylistId =
      channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploadsPlaylistId) {
      return res.json({ id_profile, profile_name: profile.name, last_scheduled: null })
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
      return res.json({ id_profile, profile_name: profile.name, last_scheduled: null })
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

    // Algoritmo: cadena consecutiva desde hoy (UTC)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    let lastConsecutive: Date | null = null
    let current = new Date(today)
    while (true) {
      const next = new Date(current)
      next.setUTCDate(next.getUTCDate() + 1)
      if (coveredDays.has(toUtcDateString(next))) {
        lastConsecutive = next
        current = next
      } else {
        break
      }
    }

    // Fallback: si no hay cadena, devolver el último video existente
    const lastScheduled = lastConsecutive
      ?? (allDates.length > 0 ? new Date(Math.max(...allDates.map(d => d.getTime()))) : null)

    res.json({
      id_profile,
      profile_name: profile.name,
      last_scheduled: lastScheduled?.toISOString() ?? null,
    })
  })
)
