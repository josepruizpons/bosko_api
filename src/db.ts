import "dotenv/config";
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'
const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaPg({ connectionString })
export const db = new PrismaClient({ adapter })

const asset_select = {
  id: true,
  name: true,
  type: true,
  s3_key: true,
  beatstars_id: true,
  crop_data: true,
} as const

export const track_include = {
  beat: { select: asset_select },
  thumbnail: { select: asset_select },
  stem: { select: asset_select },
} as const
