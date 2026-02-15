import "dotenv/config";
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'
const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaPg({ connectionString })
export const db = new PrismaClient({ adapter })

export const track_include = {
  beat: {
    select: {
      id: true,
      name: true,
      type: true,
      s3_key: true,
      beatstars_id: true
    }
  },
  thumbnail: {
    select: {
      id: true,
      name: true,
      type: true,
      s3_key: true,
      beatstars_id: true
    }
  }
}
