
export const TRACK_STATUS = {
  DRAFT: 'draft',
  LINKED_ASSETS: 'linked_assets',
  BS_UPLOADED: 'BS_UPLOADED',
  BS_PUBLISHED: 'bs_published',
  YT_PUBLISHED: 'yt_published',
  LOADING: 'loading',
} as const
export const BS_ASSET_TYPE = {
  AUDIO: 'AUDIO',
  IMAGE: 'IMAGE',
} as const
export const ASSET_TYPE = {
  BEAT: 'BEAT',
  THUMBNAIL: 'THUMBNAIL',
} as const

export const PLATFORMS = {
  BEATSTARS: 'BEATSTARS',
  YOUTUBE: 'YOUTUBE',
} as const

// Track status is computed from DB fields (no persisted status column).
export enum ComputedTrackStatus {
  Created = 'created',
  PartialAssets = 'partial_assets',
  AssetsLinked = 'assets_linked',
  AssetsUploadedBeatstars = 'assets_uploaded_beatstars',
  PublishedBeatstars = 'published_beatstars',
  Completed = 'completed',
  Error = 'error',
}

export const COMPUTED_TRACK_STATUS_VALUES = Object.values(ComputedTrackStatus) as ComputedTrackStatus[]

export const PROD_HOSTNAME = 'https://api.boskofiles.com' as const
