import express from 'express'
import { asyncHandler, generate_id, get_current_user, get_profile } from "../utils";
import { api_error400, api_error403, api_error404 } from '../errors';
import { db } from '../db'
import { db_profile_to_profile } from '../mappers';
import { PLATFORMS } from '../constants';
import type { Platform } from '../types/types';

export const profiles_router = express.Router()

// GET /api/profiles — List profiles for current user
profiles_router.get('/',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)

    const db_profiles = await db.profiles.findMany({
      where: { id_user: user.id },
      include: { profile_connections: true }
    })

    const profiles = db_profiles.map(p => db_profile_to_profile(p))
    res.json(profiles)
  })
)

// POST /api/profiles — Create profile
profiles_router.post('/',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)

    const name: string | null = req.body.name ?? null
    if (typeof name !== 'string' || name.length < 1) {
      return api_error400('Name is required')
    }

    const profile_id = generate_id()
    const db_profile = await db.profiles.create({
      data: {
        id: profile_id,
        id_user: user.id,
        name,
        settings: req.body.settings ?? {},
      },
      include: { profile_connections: true }
    })

    res.status(201).json(db_profile_to_profile(db_profile))
  })
)

// PATCH /api/profiles/:id — Update profile
profiles_router.patch('/:id',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id = req.params.id as string

    // Verify ownership
    await get_profile(user.id, id)

    const updateData: Record<string, unknown> = {}

    if ('name' in req.body) {
      if (typeof req.body.name !== 'string' || req.body.name.length < 1) {
        return api_error400('Invalid name')
      }
      updateData.name = req.body.name
    }

    if ('settings' in req.body) {
      updateData.settings = req.body.settings
    }

    if (Object.keys(updateData).length === 0) {
      return api_error400('No fields to update')
    }

    const updated = await db.profiles.update({
      where: { id },
      data: updateData,
      include: { profile_connections: true }
    })

    res.json(db_profile_to_profile(updated))
  })
)

// DELETE /api/profiles/:id — Delete profile (cascades tracks, assets, connections)
profiles_router.delete('/:id',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id = req.params.id as string

    // Verify ownership
    await get_profile(user.id, id)

    await db.profiles.delete({ where: { id } })

    res.json({ success: true })
  })
)

// --- Profile Connections ---

// POST /api/profiles/:id/connections — Create connection
profiles_router.post('/:id/connections',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id_profile = req.params.id as string

    // Verify ownership
    await get_profile(user.id, id_profile)

    const platform: string | null = req.body.platform ?? null
    const id_oauth: number | null = req.body.id_oauth ?? null
    const meta: unknown = req.body.meta ?? null

    if (platform !== PLATFORMS.YOUTUBE && platform !== PLATFORMS.BEATSTARS) {
      return api_error400('Invalid platform. Must be "YOUTUBE" or "BEATSTARS"')
    }

    if (typeof id_oauth !== 'number') {
      return api_error400('id_oauth is required and must be a number')
    }

    // Verify the oauth record exists and belongs to the user
    const oauth = await db.oauth.findUnique({ where: { id: id_oauth } })
    if (!oauth) return api_error404('OAuth record not found')
    if (oauth.id_user !== user.id) return api_error403('OAuth record does not belong to user')

    // Check if connection already exists for this profile + platform
    const existing = await db.profile_connections.findUnique({
      where: {
        id_profile_platform: {
          id_profile,
          platform,
        }
      }
    })

    if (existing) {
      return api_error400(`Profile already has a ${platform} connection`)
    }

    const connection = await db.profile_connections.create({
      data: {
        id: generate_id(),
        id_profile,
        id_oauth,
        platform,
        meta: meta as any ?? {},
      }
    })

    // Return updated profile
    const profile = await db.profiles.findUnique({
      where: { id: id_profile },
      include: { profile_connections: true }
    })

    res.status(201).json(db_profile_to_profile(profile!))
  })
)

// PATCH /api/profiles/:id/connections/:platform — Update connection meta
profiles_router.patch('/:id/connections/:platform',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id_profile = req.params.id as string
    const platform = req.params.platform as string

    // Verify ownership
    await get_profile(user.id, id_profile)

    if (platform !== PLATFORMS.YOUTUBE && platform !== PLATFORMS.BEATSTARS) {
      return api_error400('Invalid platform')
    }

    const connection = await db.profile_connections.findUnique({
      where: {
        id_profile_platform: {
          id_profile,
          platform,
        }
      }
    })

    if (!connection) return api_error404('Connection not found')

    const updateData: Record<string, unknown> = {}

    if ('meta' in req.body) {
      updateData.meta = req.body.meta
    }

    if ('id_oauth' in req.body) {
      if (typeof req.body.id_oauth !== 'number') {
        return api_error400('id_oauth must be a number')
      }
      // Verify the oauth record exists and belongs to the user
      const oauth = await db.oauth.findUnique({ where: { id: req.body.id_oauth } })
      if (!oauth) return api_error404('OAuth record not found')
      if (oauth.id_user !== user.id) return api_error403('OAuth record does not belong to user')
      updateData.id_oauth = req.body.id_oauth
    }

    if (Object.keys(updateData).length === 0) {
      return api_error400('No fields to update')
    }

    await db.profile_connections.update({
      where: {
        id_profile_platform: {
          id_profile,
          platform,
        }
      },
      data: updateData,
    })

    // Return updated profile
    const profile = await db.profiles.findUnique({
      where: { id: id_profile },
      include: { profile_connections: true }
    })

    res.json(db_profile_to_profile(profile!))
  })
)

// DELETE /api/profiles/:id/connections/:platform — Remove connection
profiles_router.delete('/:id/connections/:platform',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id_profile = req.params.id as string
    const platform = req.params.platform as string

    // Verify ownership
    await get_profile(user.id, id_profile)

    if (platform !== PLATFORMS.YOUTUBE && platform !== PLATFORMS.BEATSTARS) {
      return api_error400('Invalid platform')
    }

    const connection = await db.profile_connections.findUnique({
      where: {
        id_profile_platform: {
          id_profile,
          platform,
        }
      }
    })

    if (!connection) return api_error404('Connection not found')

    await db.profile_connections.delete({
      where: {
        id_profile_platform: {
          id_profile,
          platform,
        }
      }
    })

    res.json({ success: true })
  })
)
