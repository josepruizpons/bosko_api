
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
  BINARY: 'BINARY',
} as const
export const ASSET_TYPE = {
  BEAT: 'BEAT',
  THUMBNAIL: 'THUMBNAIL',
  STEM: 'STEM',
  VIDEO_LOOP: 'VIDEO_LOOP',
} as const

export const VALID_STEM_MIMETYPES = ['application/zip', 'application/x-zip-compressed'] as const

export const VALID_VIDEO_LOOP_MIMETYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'image/gif',
] as const

export const MAX_VIDEO_LOOP_SECONDS = 10
export const MAX_VIDEO_LOOP_SECONDS_TOLERANCE = 10.5

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

export const PROD_HOSTNAME = process.env.PROD_HOSTNAME ?? 'https://api.boskofiles.com' as const
