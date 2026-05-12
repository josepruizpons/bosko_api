import { Prisma } from "../generated/prisma/client"
import { track_include } from "../db"

export type DbTrack = Prisma.trackGetPayload<{ include: typeof track_include }>

export type DbProfileConnection = Prisma.profile_connectionsGetPayload<{}>
export type DbProfile = Prisma.profilesGetPayload<{
  include: {
    profile_connections: true
  }
}>

export type DbAsset = Prisma.assetModel
