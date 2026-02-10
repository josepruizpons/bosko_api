import express from 'express'
import { asyncHandler, generate_id, get_current_user } from "../utils";
import { api_error400, api_error403, api_error404 } from '../errors';
import { db } from '../db'
import { COMPUTED_TRACK_STATUS_VALUES, ComputedTrackStatus } from '../constants'
import { compute_track_status } from '../track_status'
import { getSignedFileUrl } from '../aws';

export const tracks_router = express.Router()

// GET /api/tracks - List tracks for current user
tracks_router.get('/',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)

      const status_filter = req.query.status as string | undefined

      const where_clause: any = { id_user: user.id }

      // Basic server-side filters (computed filters applied after fetch)
      if (status_filter === 'pending') {
        where_clause.yt_url = null
      }
      if (status_filter === 'completed') {
        where_clause.yt_url = { not: null }
      }

      const tracks = await db.track.findMany({
        where: where_clause,
        include: {
          asset_track_id_beatToasset: {
            select: {
              id: true,
              name: true,
              type: true,
              beatstars_id: true
            }
          },
          asset_track_id_thumbnailToasset: {
            select: {
              id: true,
              name: true,
              type: true,
              beatstars_id: true
            }
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      })

      const enriched = tracks.map(t => ({
        ...t,
        computed_status: compute_track_status(t as any)
      }))

      const filtered = (() => {
        if (!status_filter) return enriched

        if (status_filter === 'pending' || status_filter === 'completed') {
          return enriched
        }

        // Computed status values
        if (COMPUTED_TRACK_STATUS_VALUES.includes(status_filter as ComputedTrackStatus)) {
          return enriched.filter(t => t.computed_status === status_filter)
        }

        // Convenience filters
        if (status_filter === 'needs_assets') {
          return enriched.filter(t => (
            t.computed_status === ComputedTrackStatus.Created
            || t.computed_status === ComputedTrackStatus.PartialAssets
          ))
        }

        if (status_filter === 'needs_beatstars_upload') {
          return enriched.filter(t => t.computed_status === ComputedTrackStatus.AssetsLinked)
        }

        if (status_filter === 'needs_beatstars_publish') {
          return enriched.filter(t => t.computed_status === ComputedTrackStatus.AssetsUploadedBeatstars)
        }

        if (status_filter === 'needs_youtube') {
          return enriched.filter(t => t.computed_status === ComputedTrackStatus.PublishedBeatstars)
        }

        return enriched
      })()

      // Ignore persisted status columns (if present in DB) and only expose computed_status
      const response_payload = filtered.map(({ status: _ignored_status, ...rest }: any) => rest)

      res.json(response_payload)
    }
  )
)

// GET /api/tracks - List pending tracks for current user
tracks_router.get('/pending',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)
      const tracks = await db.track.findMany({
        where: {
          yt_url: null,
          id_user: user.id,
        },
        include: {
          asset_track_id_beatToasset: {
            select: {
              id: true,
              name: true,
              type: true,
              s3_key: true,
              beatstars_id: true
            }
          },
          asset_track_id_thumbnailToasset: {
            select: {
              id: true,
              name: true,
              type: true,
              s3_key: true,
              beatstars_id: true
            }
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      })

      //TODO: review urls
      const enriched = tracks.map(t => ({
        ...t,
        beat_url: t.asset_track_id_beatToasset?.s3_key ? getSignedFileUrl(t.asset_track_id_beatToasset.s3_key) : null,
        thumbnail_url: t.asset_track_id_thumbnailToasset?.s3_key ? getSignedFileUrl(t.asset_track_id_thumbnailToasset.s3_key) : null,
        computed_status: compute_track_status(t as any)
      }))
     //
     // // Ignore persisted status columns (if present in DB) and only expose computed_status
     // const response_payload = enriched.map(({ status: _ignored_status, ...rest }: any) => rest)

      res.json(enriched)
    }
  )
)

tracks_router.post('/',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)

      const name: string = req.body.name
      const id_beat: string | null = req.body.id_beat ?? null
      const id_thumbnail: string | null = req.body.id_thumbnail ?? null
      const publish_at: string | null = req.body.publish_at ?? null
      const yt_url: string | null = req.body.yt_url ?? null

      if (typeof name !== 'string') {
        return api_error400('Missing required field: name')
      }

      // Validate assets only if provided
      if (id_beat !== null) {
        const beat = await db.asset.findUnique({
          where: { id: id_beat }
        })
        if (beat === null) {
          return api_error404('Beat not found')
        }
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
      if (publish_date !== null && isNaN(publish_date.getTime())) {
        return api_error400('Invalid publish_at date')
      }

      const track_id = generate_id()
      const track = await db.track.create({
        data: {
          id: track_id,
          id_user: user.id,
          name,
          id_beat,
          id_thumbnail,
          publish_at: publish_date,
          yt_url: yt_url ?? null,
        }
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
        where: { id }
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

      const updatedTrack = await db.track.update({
        where: { id },
        data: updateData
      })

      res.json(updatedTrack)
    }
  )
)

// tracks_router.patch('/:id/assets',
//   asyncHandler(
//     async (req, res) => {
//       const user = await get_current_user(req)
//       const id = req.params.id as string
//
//       const existingTrack = await db.track.findUnique({
//         where: { id }
//       })
//
//       if (existingTrack === null) {
//         return api_error404('Track not found')
//       }
//
//       if (existingTrack.id_user !== user.id) {
//         return api_error403('You do not have permission to modify this track')
//       }
//
//       const updateData: any = {}
//
//       if ('id_beat' in req.body) {
//         if (req.body.id_beat === null) {
//           return api_error400('id_beat cannot be null')
//         }
//         if (typeof req.body.id_beat !== 'string') {
//           return api_error400('Invalid id_beat')
//         }
//         const beat = await db.asset.findUnique({
//           where: { id: req.body.id_beat }
//         })
//         if (beat === null) {
//           return api_error404('Beat not found')
//         }
//         updateData.id_beat = req.body.id_beat
//       }
//
//       if ('id_thumbnail' in req.body) {
//         if (req.body.id_thumbnail === null) {
//           return api_error400('id_thumbnail cannot be null')
//         }
//         if (typeof req.body.id_thumbnail !== 'string') {
//           return api_error400('Invalid id_thumbnail')
//         }
//         const thumbnail = await db.asset.findUnique({
//           where: { id: req.body.id_thumbnail }
//         })
//         if (thumbnail === null) {
//           return api_error404('Thumbnail not found')
//         }
//         updateData.id_thumbnail = req.body.id_thumbnail
//       }
//
//       if (Object.keys(updateData).length === 0) {
//         return api_error400('No assets to update. Provide id_beat or id_thumbnail')
//       }
//
//       // Update status to assets_ready when both assets are present
//       const updatedTrack = await db.track.update({
//         where: { id },
//         data: updateData
//       })
//
//       res.json(updatedTrack)
//     }
//   )
// )
