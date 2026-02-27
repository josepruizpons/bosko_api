import express from 'express'
import { get_current_user, asyncHandler } from "../utils";
import { db } from '../db'
import type { UserInfo, Settings } from '../types/types';
import { db_profile_to_profile } from '../mappers';

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

    const db_profiles = await db.profiles.findMany({
      where: { id_user: user.id },
      include: {
        profile_connections: true,
      }
    })

    const userInfo: UserInfo = {
      id: user.id,
      email: user.email,
      is_active: user.is_active ?? false,
      created_at: user.created_at ?? new Date(),
      last_publish_at: lastTrack?.publish_at ?? null,
      settings: user.settings as Settings,
      profiles: db_profiles.map(p => db_profile_to_profile(p)),
    }

    res.json(userInfo)
  })
)
