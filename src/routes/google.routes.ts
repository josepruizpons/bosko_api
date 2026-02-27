import express from 'express'
import { google } from 'googleapis';
import { api_error400, api_error500 } from '../errors';
import { buffer_to_stream, generate_video, get_current_user, get_profile, youtubeUrl } from '../utils';
import { get_google_client } from '../google_auth';
import { db, track_include } from '../db'
import { deleteFileFromS3, downloadFileFromS3, invokeVideoLambda } from '../aws';
import { db_track_to_track } from '../mappers';
import { PLATFORMS } from '../constants';

export const google_router = express.Router();

// Ruta GET /google
google_router.get('/connect', async (req, res) => {
  const user = await get_current_user(req)
  const id_profile = req.query.id_profile as string | undefined

  if (!id_profile) {
    return api_error400('Missing required query param: id_profile')
  }

  await get_profile(user.id, id_profile)

  const google_client = await get_google_client(id_profile)

  const scopes = [
    // "https://www.googleapis.com/auth/youtube.upload",
    'https://www.googleapis.com/auth/youtube',
  ];

  const url = google_client.generateAuthUrl({
    access_type: "offline",
    prompt: 'consent',
    scope: scopes,
    state: JSON.stringify({ userId: user.id, id_profile }),
  });

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
        ? yt_meta.description.replace('{{beatstars_url}}', track.beatstars_url ?? '')
        : default_description

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
          track.name
        );

        console.log('Lambda returned S3 key:', videoS3Key);

        // Download video from S3 using SDK
        videoBuffer = await downloadFileFromS3(videoS3Key);

        console.log('Video downloaded from S3: ' + track.name);
      } else {
        // Development: Download from S3 and generate video locally
        console.log('Development: Downloading assets from S3 for local video generation');

        const audioBuffer = await downloadFileFromS3(beatAsset.s3_key);
        const thumbBuffer = await downloadFileFromS3(thumbnailAsset.s3_key);

        videoBuffer = await generate_video(audioBuffer, thumbBuffer)
        console.log('Video generated locally: ' + track.name)
      }

      // Subir a YouTube
      const youtube = google.youtube({ version: 'v3', auth: google_client })

      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: track.name,
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
