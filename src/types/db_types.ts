import { Prisma } from "../generated/prisma/client"

type DbTrackBase = Prisma.trackGetPayload<{
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

// bpm, musical_key, tags y genres se añaden a la DB pero el cliente generado aún no los refleja
export type DbTrack = DbTrackBase & {
  bpm?: string | null;
  musical_key?: string | null;
  tags?: string[] | null;
  genres?: string[] | null;
}

export type DbProfileConnection = Prisma.profile_connectionsGetPayload<{}>
export type DbProfile = Prisma.profilesGetPayload<{
  include: {
    profile_connections: true
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
