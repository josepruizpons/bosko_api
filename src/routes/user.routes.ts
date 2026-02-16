import express from 'express'
import { get_current_user, asyncHandler } from "../utils";
import { db } from '../db'
import { CONNECTION_TYPES } from '../constants';
import type { UserInfo } from '../types/types';

export const user_router = express.Router()

user_router.get('/info',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)

    // Get last publish date from tracks
    const lastTrack = await db.track.findFirst({
      where: { id_user: user.id },
      orderBy: { publish_at: 'desc' },
      select: { publish_at: true }
    })

    // Get OAuth connections
    const oauthConnections = await db.oauth.findMany({
      where: { id_user: user.id },
      select: { connection_type: true }
    })

    const hasYoutube = oauthConnections.some(
      c => c.connection_type === CONNECTION_TYPES.YOUTUBE
    )
    const hasBeatstars = oauthConnections.some(
      c => c.connection_type === CONNECTION_TYPES.BEATSTARS
    )

    const userInfo: UserInfo = {
      id: user.id,
      email: user.email,
      is_active: user.is_active ?? false,
      created_at: user.created_at ?? new Date(),
      last_publish_at: lastTrack?.publish_at ?? null,
      connections: {
        youtube: hasYoutube,
        beatstars: hasBeatstars
      }
    }

    res.json(userInfo)
  })
)
