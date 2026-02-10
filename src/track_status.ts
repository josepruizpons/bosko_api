import { ComputedTrackStatus } from './constants'

export type TrackWithAssets = {
  id: string
  id_user: number
  name: string
  id_beat: string | null
  id_thumbnail: string | null
  yt_url: string | null
  beatstars_url: string | null
  beatstars_id_track: string | null
  error_message: string | null
  asset_track_id_beatToasset: { beatstars_id: string | null } | null
  asset_track_id_thumbnailToasset: { beatstars_id: string | null } | null
}

export const compute_track_status = (t: TrackWithAssets): ComputedTrackStatus => {
  if (t.yt_url) return ComputedTrackStatus.Completed

  if (t.beatstars_url) {
    return ComputedTrackStatus.PublishedBeatstars
  }

  const hasBeat = Boolean(t.id_beat)
  const hasThumbnail = Boolean(t.id_thumbnail)

  if (hasBeat && hasThumbnail) {
    const beatUploaded = Boolean(t.asset_track_id_beatToasset?.beatstars_id)
    const thumbnailUploaded = Boolean(t.asset_track_id_thumbnailToasset?.beatstars_id)

    if (beatUploaded && thumbnailUploaded) {
      return ComputedTrackStatus.AssetsUploadedBeatstars
    }

    return ComputedTrackStatus.AssetsLinked
  }

  if (hasBeat || hasThumbnail) return ComputedTrackStatus.PartialAssets

  if (t.error_message) return ComputedTrackStatus.Error

  return ComputedTrackStatus.Created
}
