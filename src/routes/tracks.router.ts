import express from 'express'
import crypto from 'crypto'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { asyncHandler, generate_id, get_current_user, get_profile } from "../utils";
import { api_error400, api_error403, api_error404, api_error500 } from '../errors';
import { db, track_include } from '../db'
import { DbTrack } from '../types/db_types';
import { db_track_to_track } from '../mappers';
import { deleteFileFromS3 } from '../aws';
import { ASSET_TYPE, PROD_HOSTNAME } from '../constants';
import bs_key_notes_data from '../api/bs_key_notes.json';

const VALID_KEY_NOTE_KEYS = new Set(bs_key_notes_data.keyNotes.map((k: { key: string }) => k.key));

export const tracks_router = express.Router()

// GET /api/tracks/pending - List pending tracks for a profile
tracks_router.get('/pending',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)
      const id_profile = req.query.id_profile as string | undefined

      if (!id_profile) {
        return api_error400('Missing required query param: id_profile')
      }

      await get_profile(user.id, id_profile)

      const db_tracks: DbTrack[] = await db.track.findMany({
        where: {
          yt_url: null,
          id_profile,
          archived_at: null,
        },
        include: track_include,
        orderBy: [
          { publish_at: "asc" },
          { created_at: "asc" }
        ]
      })
      const tracks = await Promise.all(
        db_tracks.map(
          async (track) => await db_track_to_track(track)
        )
      )
      res.json(tracks)
    }
  )
)

// POST /api/tracks - Create track
tracks_router.post('/',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)

      const id_profile: string | undefined = req.body.id_profile
      if (!id_profile) {
        return api_error400('Missing required field: id_profile')
      }

      await get_profile(user.id, id_profile)

      const name: string | null = req.body.name ?? null
      const id_beat: string | null = req.body.id_beat ?? null
      const id_thumbnail: string | null = req.body.id_thumbnail ?? null
      const id_stem: string | null = req.body.id_stem ?? null
      const id_video_loop: string | null = req.body.id_video_loop ?? null
      const publish_at: Date | null = req.body.publish_at
        ? new Date(req.body.publish_at)
        : null
      const yt_url: string | null = req.body.yt_url ?? null
      const bpm: string | null = req.body.bpm ?? null
      const musical_key: string | null = req.body.musical_key ?? null

      if (typeof name !== 'string') {
        return api_error400('Missing required field: name')
      }

      // Validate assets only if provided

      if (!name) {
        return api_error400('Name required')
      } else if (name.length < 3) {
        return api_error400('Name must be at least 3char')
      }

      if (id_beat !== null) {
        const beat = await db.asset.findUnique({
          where: { id: id_beat }
        })
        if (beat === null) {
          return api_error404('Beat not found')
        }
      }

      if (publish_at && isNaN(publish_at.getTime())) {
        return api_error400('Invalid publish_at date')
      }

      if (id_thumbnail !== null) {
        const thumbnail = await db.asset.findUnique({
          where: { id: id_thumbnail }
        })
        if (thumbnail === null) {
          return api_error404('Thumbnail not found')
        }
      }

      if (id_stem !== null) {
        const stem = await db.asset.findUnique({
          where: { id: id_stem }
        })
        if (stem === null) {
          return api_error404('Stem not found')
        }
      }

      if (id_video_loop !== null) {
        const video_loop = await db.asset.findUnique({
          where: { id: id_video_loop }
        })
        if (video_loop === null) {
          return api_error404('Video loop not found')
        }
        if (video_loop.type !== ASSET_TYPE.VIDEO_LOOP) {
          return api_error400('id_video_loop must reference a VIDEO_LOOP asset')
        }
      }


      const publish_date = publish_at === null ? null : new Date(publish_at)
      if (publish_date === null || (
        publish_date !== null && isNaN(publish_date.getTime()))
      ) {
        return api_error400('Invalid publish_at date')
      }

      if (musical_key !== null && !VALID_KEY_NOTE_KEYS.has(musical_key)) {
        return api_error400(`Invalid musical_key. Valid values: ${[...VALID_KEY_NOTE_KEYS].join(', ')}`)
      }

      const track_id = generate_id()
      const created_track = await db.track.create({
        data: {
          id: track_id,
          id_user: user.id,
          id_profile,
          name,
          id_beat,
          id_thumbnail,
          id_stem,
          id_video_loop,
          publish_at: publish_date,
          yt_url: yt_url ?? null,
          ...(bpm !== null && { bpm }),
          ...(musical_key !== null && { musical_key }),
        }
      })

      const track = await db_track_to_track({
        ...created_track,
        thumbnail: null,
        beat: null,
        stem: null,
        video_loop: null,
      })
      res.status(201).json(track)
    }
  )
)

tracks_router.patch('/:id',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)
      const id = req.params.id as string

      const existingTrack = await db.track.findUnique({
        where: { id, id_user: user.id }
      })

      if (existingTrack === null) {
        return api_error404('Track not found')
      }

      if (existingTrack.id_user !== user.id) {
        return api_error403('You do not have permission to modify this track')
      }

      const updateData: any = {}

      if ('name' in req.body) {
        if (typeof req.body.name !== 'string') {
          return api_error400('Invalid name')
        }
        updateData.name = req.body.name
      }

      if ('publish_at' in req.body) {
        if (req.body.publish_at === null) {
          updateData.publish_at = null
        } else if (typeof req.body.publish_at === 'string') {
          const publish_date = new Date(req.body.publish_at)
          if (isNaN(publish_date.getTime())) {
            return api_error400('Invalid publish_at date')
          }
          updateData.publish_at = publish_date
        } else {
          return api_error400('Invalid publish_at')
        }
      }

      if ('id_beat' in req.body) {
        if (typeof req.body.id_beat !== 'string') {
          return api_error400('Invalid id_beat')
        }
        const beat = await db.asset.findUnique({
          where: { id: req.body.id_beat }
        })
        if (beat === null) {
          return api_error404('Beat not found')
        }
        updateData.id_beat = req.body.id_beat
      }

      if ('id_thumbnail' in req.body) {
        if (req.body.id_thumbnail === null) {
          updateData.id_thumbnail = null
        } else if (typeof req.body.id_thumbnail === 'string') {
          const thumbnail = await db.asset.findUnique({
            where: { id: req.body.id_thumbnail }
          })
          if (thumbnail === null) {
            return api_error404('Thumbnail not found')
          }
          updateData.id_thumbnail = req.body.id_thumbnail
        } else {
          return api_error400('Invalid id_thumbnail')
        }
      }

      if ('id_stem' in req.body) {
        if (req.body.id_stem === null) {
          updateData.id_stem = null
        } else if (typeof req.body.id_stem === 'string') {
          const stem = await db.asset.findUnique({
            where: { id: req.body.id_stem }
          })
          if (stem === null) {
            return api_error404('Stem not found')
          }
          updateData.id_stem = req.body.id_stem
        } else {
          return api_error400('Invalid id_stem')
        }
      }

      if ('id_video_loop' in req.body) {
        if (req.body.id_video_loop === null) {
          updateData.id_video_loop = null
        } else if (typeof req.body.id_video_loop === 'string') {
          const video_loop = await db.asset.findUnique({
            where: { id: req.body.id_video_loop }
          })
          if (video_loop === null) {
            return api_error404('Video loop not found')
          }
          if (video_loop.type !== ASSET_TYPE.VIDEO_LOOP) {
            return api_error400('id_video_loop must reference a VIDEO_LOOP asset')
          }
          updateData.id_video_loop = req.body.id_video_loop
        } else {
          return api_error400('Invalid id_video_loop')
        }
      }

      if ('bpm' in req.body) {
        if (req.body.bpm !== null && typeof req.body.bpm !== 'string') {
          return api_error400('Invalid bpm')
        }
        updateData.bpm = req.body.bpm ?? null
      }

      if ('musical_key' in req.body) {
        if (req.body.musical_key !== null && typeof req.body.musical_key !== 'string') {
          return api_error400('Invalid musical_key')
        }
        if (req.body.musical_key !== null && !VALID_KEY_NOTE_KEYS.has(req.body.musical_key)) {
          return api_error400(`Invalid musical_key. Valid values: ${[...VALID_KEY_NOTE_KEYS].join(', ')}`)
        }
        updateData.musical_key = req.body.musical_key ?? null
      }

      if (Object.keys(updateData).length === 0) {
        return api_error400('No fields to update')
      }

      const updated_track = await db.track.update({
        where: { id },
        data: updateData,
        include: track_include,
      })

      const mapped_track = await db_track_to_track(updated_track)
      res.json(mapped_track)
    }
  )
)

tracks_router.delete('/:id',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id = req.params.id as string

    // Obtener el track con sus assets para conseguir los s3_key
    const track_to_delete = await db.track.findUnique({
      where: { id, id_user: user.id },
      include: track_include
    })

    if (!track_to_delete) {
      return api_error404('Track not found')
    }

    // Tracks ya publicados (yt_url != null) → soft delete (preservar para historial).
    if (track_to_delete.yt_url) {
      const archived = await db.track.update({
        where: { id, id_user: user.id },
        data: { archived_at: new Date() },
        include: track_include,
      })
      return res.json(await db_track_to_track(archived))
    }

    // Eliminar el track de la base de datos
    const deleted_track = await db.track.delete({
      where: { id, id_user: user.id },
      include: track_include
    })

    // Eliminar assets de S3 asociados (beat y thumbnail)
    if (track_to_delete.beat?.s3_key) {
      try {
        await deleteFileFromS3(track_to_delete.beat.s3_key);
        console.log('Beat deleted from S3 on track delete:', track_to_delete.beat.s3_key);
      } catch (deleteErr) {
        console.error('Error deleting beat from S3 on track delete:', deleteErr);
      }
    }

    if (track_to_delete.stem?.s3_key) {
      try {
        await deleteFileFromS3(track_to_delete.stem.s3_key);
        console.log('Stem deleted from S3 on track delete:', track_to_delete.stem.s3_key);
      } catch (deleteErr) {
        console.error('Error deleting stem from S3 on track delete:', deleteErr);
      }
    }

    if (track_to_delete.thumbnail?.s3_key) {
      try {
        await deleteFileFromS3(track_to_delete.thumbnail.s3_key);
        console.log('Thumbnail deleted from S3 on track delete:', track_to_delete.thumbnail.s3_key);
      } catch (deleteErr) {
        console.error('Error deleting thumbnail from S3 on track delete:', deleteErr);
      }
    }

    if (track_to_delete.video_loop?.s3_key) {
      try {
        await deleteFileFromS3(track_to_delete.video_loop.s3_key);
        console.log('Video loop deleted from S3 on track delete:', track_to_delete.video_loop.s3_key);
      } catch (deleteErr) {
        console.error('Error deleting video loop from S3 on track delete:', deleteErr);
      }
    }

    res.json(await db_track_to_track(deleted_track))
  })
)

// GET /api/tracks/history - List published (archived=false, yt_url != null) tracks for a profile
tracks_router.get('/history',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id_profile = req.query.id_profile as string | undefined

    if (!id_profile) {
      return api_error400('Missing required query param: id_profile')
    }

    await get_profile(user.id, id_profile)

    const db_tracks: DbTrack[] = await db.track.findMany({
      where: {
        id_profile,
        id_user: user.id,
        yt_url: { not: null },
        archived_at: null,
      },
      include: track_include,
      orderBy: [
        { published_at: 'desc' },
        { created_at: 'desc' },
      ],
    })

    const tracks = await Promise.all(db_tracks.map(t => db_track_to_track(t)))
    res.json(tracks)
  })
)

const lambda_client = new LambdaClient({
  region: process.env.AWS_REGION || 'eu-west-3',
  credentials: {
    accessKeyId: process.env.AWS_ID!,
    secretAccessKey: process.env.AWS_SECRET_KEY!,
  },
})

// POST /api/tracks/:id/publish - Trigger async publish via Lambda
tracks_router.post('/:id/publish',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id = req.params.id as string

    const track = await db.track.findUnique({
      where: { id },
      include: track_include,
    })

    if (!track) return api_error404('Track not found')
    if (track.id_user !== user.id) return api_error403('You do not have permission to publish this track')
    if (!track.id_profile) return api_error400('Track has no profile assigned')
    if (track.yt_url) return api_error400('Track already published')

    if (!track.id_beat) return api_error400('Track is missing beat')
    if (!track.id_thumbnail && !track.id_video_loop) {
      return api_error400('Track is missing thumbnail or video_loop')
    }

    if (track.publishing_started_at) {
      // Already in progress — return current job idempotently
      return res.status(202).json({
        job_id: track.publishing_job_id,
        id_track: track.id,
        status: 'already_in_progress',
      })
    }

    const secret = process.env.LAMBDA_WEBHOOK_SECRET
    if (!secret) return api_error500('LAMBDA_WEBHOOK_SECRET not configured')

    const function_name = process.env.AWS_LAMBDA_PUBLISH_FUNCTION_NAME || 'bosko-publish'

    const job_id = crypto.randomUUID()
    const callback_url = process.env.NODE_ENV === 'production'
      ? `${PROD_HOSTNAME}/webhooks/lambda-event`
      : `https://host.docker.internal:3000/webhooks/lambda-event`

    // Read yt_crop_thumbnail option from profile settings
    const profile_for_settings = await db.profiles.findUnique({ where: { id: track.id_profile } })
    const profile_settings = (profile_for_settings?.settings ?? {}) as Record<string, string>
    const yt_crop_thumbnail = profile_settings.yt_crop_thumbnail === 'true'

    await db.track.update({
      where: { id },
      data: {
        publishing_started_at: new Date(),
        publishing_job_id: job_id,
        error_message: null,
        error_phase: null,
        aborted_at: null,
      },
    })

    const payload = {
      job_id,
      id_track: track.id,
      id_user: user.id,
      id_profile: track.id_profile,
      callback_url,
      callback_token: secret,
      options: { yt_crop_thumbnail },
    }

    try {
      await lambda_client.send(new InvokeCommand({
        FunctionName: function_name,
        InvocationType: 'Event',
        Payload: JSON.stringify(payload),
      }))
    } catch (err) {
      // Revert publishing flags on invocation failure
      await db.track.update({
        where: { id },
        data: {
          publishing_started_at: null,
          publishing_job_id: null,
          error_message: err instanceof Error ? err.message : 'Lambda invoke failed',
          error_phase: 'invoke',
        },
      })
      console.error('[publish] Lambda invoke failed:', err)
      return api_error500('Failed to start publish job')
    }

    res.status(202).json({ job_id, id_track: track.id })
  })
)

// POST /api/tracks/:id/publish/abort - Mark the job as aborted; Lambda checks between phases
tracks_router.post('/:id/publish/abort',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id = req.params.id as string

    const track = await db.track.findUnique({ where: { id } })
    if (!track) return api_error404('Track not found')
    if (track.id_user !== user.id) return api_error403('You do not have permission')

    if (!track.publishing_started_at) {
      return res.status(409).json({ error: 'no publish in progress' })
    }

    await db.track.update({
      where: { id },
      data: { aborted_at: new Date() },
    })

    res.status(204).send()
  })
)
