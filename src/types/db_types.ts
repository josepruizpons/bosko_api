import { Prisma } from "../generated/prisma/client"

export type DbTrack = Prisma.trackGetPayload<{
  include: {
    beat: {
      select: {
        id: true,
        name: true,
        type: true,
        s3_key: true,
        beatstars_id: true
      }
    }
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
}>

export type DbAsset = Prisma.assetModel

// Option: get type from query
//
// const tracksQuery = db.track.findMany({
//   include: {
//     beat: true,
//     thumbnail: true
//   }
// })
//
// type DbTrack = Awaited<typeof tracksQuery>[number]
