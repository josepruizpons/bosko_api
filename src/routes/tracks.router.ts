import express from 'express'
import { asyncHandler, generate_id, get_current_user, get_profile } from "../utils";
import { api_error400, api_error403, api_error404 } from '../errors';
import { db, track_include } from '../db'
import { DbTrack } from '../types/db_types';
import { db_track_to_track } from '../mappers';
import { deleteFileFromS3 } from '../aws';

export const tracks_router = express.Router()

// GET /api/tracks/last-scheduled - Last scheduled track per profile for the current user
tracks_router.get('/last-scheduled',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)

      const profiles = await db.profiles.findMany({
        where: { id_user: user.id },
        select: { id: true, name: true },
      })

      const results = await Promise.all(
        profiles.map(async (profile) => {
          const track = await db.track.findFirst({
            where: { id_profile: profile.id, yt_url: null },
            orderBy: { publish_at: 'desc' },
            select: { publish_at: true },
          })
          return {
            id_profile: profile.id,
            profile_name: profile.name,
            last_scheduled: track?.publish_at ?? null,
          }
        })
      )

      res.json(results)
    }
  )
)

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
      const publish_at: Date | null = req.body.publish_at
        ? new Date(req.body.publish_at)
        : null
      const yt_url: string | null = req.body.yt_url ?? null

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
        throw new Error("Invalid date")
      }

      if (id_thumbnail !== null) {
        const thumbnail = await db.asset.findUnique({
          where: { id: id_thumbnail }
        })
        if (thumbnail === null) {
          return api_error404('Thumbnail not found')
        }
      }


      const publish_date = publish_at === null ? null : new Date(publish_at)
      if (publish_date === null || (
        publish_date !== null && isNaN(publish_date.getTime()))
      ) {
        return api_error400('Invalid publish_at date')
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
          publish_at: publish_date,
          yt_url: yt_url ?? null,
        }
      })

      const track = await db_track_to_track({
        ...created_track,
        thumbnail: null,
        beat: null,
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
        if (typeof req.body.id_thumbnail !== 'string') {
          return api_error400('Invalid id_thumbnail')
        }
        const thumbnail = await db.asset.findUnique({
          where: { id: req.body.id_thumbnail }
        })
        if (thumbnail === null) {
          return api_error404('Thumbnail not found')
        }
        updateData.id_thumbnail = req.body.id_thumbnail
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

    try {
      // First get the track with assets to get s3_key values
      const track_to_delete = await db.track.findUnique({
        where: { id, id_user: user.id },
        include: track_include
      })

      if (!track_to_delete) {
        return res.status(404).json({ message: 'Track not found' })
      }

      // Delete the track from database
      const deleted_track = await db.track.delete({
        where: { id, id_user: user.id },
        include: track_include
      })

      // Delete associated S3 assets (beat and thumbnail)
      if (track_to_delete.beat?.s3_key) {
        try {
          await deleteFileFromS3(track_to_delete.beat.s3_key);
          console.log('Beat deleted from S3 on track delete:', track_to_delete.beat.s3_key);
        } catch (deleteErr) {
          console.error('Error deleting beat from S3 on track delete:', deleteErr);
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

      res.json(await db_track_to_track(deleted_track))
    } catch (error) {
      res.status(404).json({ message: 'Track not found' })
    }
  })
)
