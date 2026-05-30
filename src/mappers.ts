import { get_beatstars_token, get_bs_audio_by_id, get_bs_image_by_id, get_bs_member_capabilities } from "./api/beatstars-api";
import { getSignedFileUrl } from "./aws";
import { ASSET_TYPE, PLATFORMS } from "./constants";
import { DbAsset, DbProfile, DbProfileConnection, DbTrack } from "./types/db_types";
import { Asset, AssetType, BeatstarsMeta, CropData, Profile, ProfileConnection, Settings, Track, TrackSummary, YoutubeMeta } from "./types/types";
import { compute_track_status } from "./utils";

// Resolve a single cover URL for list views. Prefers the BeatStars-hosted image
// (survives S3 cleanup); otherwise signs S3 only if the object still exists.
async function resolve_cover_url(db_track: DbTrack): Promise<string | null> {
  if (db_track.id_profile === null) return null
  const cover = db_track.thumbnail ?? db_track.video_loop
  if (!cover) return null

  if (cover.beatstars_id && cover.type === ASSET_TYPE.THUMBNAIL) {
    const bs_img = await get_bs_image_by_id(db_track.id_profile, cover.beatstars_id)
    return bs_img?.signedUrl ?? null
  }

  if (cover.s3_deleted_at) return null
  return await getSignedFileUrl(cover.s3_key)
}

// Lightweight mapper for history/list endpoints — only resolves the cover.
export const db_track_to_track_summary = async (db_track: DbTrack): Promise<TrackSummary> => ({
  id: db_track.id,
  name: db_track.name,
  published_at: db_track.published_at,
  publish_at: db_track.publish_at,
  yt_url: db_track.yt_url,
  beatstars_url: db_track.beatstars_url,
  beatstars_id_track: db_track.beatstars_id_track,
  cover_url: await resolve_cover_url(db_track),
  bpm: db_track.bpm ?? null,
  musical_key: db_track.musical_key ?? null,
})

export const db_track_to_track = async (db_track: DbTrack): Promise<Track> => {

  const mapped_track: Track = {
    id: db_track.id,
    status: compute_track_status(db_track),
    name: db_track.name,
    created_at: db_track.created_at,
    publish_at: db_track.publish_at,
    yt_url: db_track.yt_url,
    beatstars_url: db_track.beatstars_url,
    beat: null,
    thumbnail: null,
    stem: null,
    video_loop: null,
    beatstars_id_track: db_track.beatstars_id_track,
    bpm: db_track.bpm ?? null,
    musical_key: db_track.musical_key ?? null,
    tags: db_track.tags ?? [],
    genres: db_track.genres ?? [],
  }

  await Promise.all(
    [db_track.beat, db_track.thumbnail, db_track.stem, db_track.video_loop].map(
      async (asset) => {

        if (asset === null || db_track.id_profile === null) return null
        let url = null

        if (!asset.beatstars_id) {
          url = await getSignedFileUrl(asset.s3_key)
        } else if(asset.type === ASSET_TYPE.BEAT) {
          const bs_beat = await get_bs_audio_by_id(db_track.id_profile, asset.beatstars_id)
          if(bs_beat !== null){
            url = bs_beat.signedUrl
          }
         }else if (asset.type === ASSET_TYPE.THUMBNAIL) {
          const bs_img= await get_bs_image_by_id(db_track.id_profile, asset.beatstars_id)
          if(bs_img !== null){
            url = bs_img.signedUrl
          }
        } else if (asset.type === ASSET_TYPE.STEM) {
          // El stem en BS es BINARY: no expone signed URL via track form helpers,
          // así que servimos desde nuestro S3 aunque ya esté en BS.
          url = await getSignedFileUrl(asset.s3_key)
        } else if (asset.type === ASSET_TYPE.VIDEO_LOOP) {
          // VIDEO_LOOP nunca se sube a BeatStars, vive solo en nuestro S3.
          url = await getSignedFileUrl(asset.s3_key)
        }

        let asset_with_url: Asset | null = null

        if (url !== null) {

          asset_with_url = {
            id: asset.id,
            name: asset.name,
            type: asset.type as AssetType,
            url,
            s3_uploaded: true,
            bs_uploaded: asset.beatstars_id !== null,
            crop: asset.crop_data ? asset.crop_data as CropData : undefined,
            mimetype: asset.mimetype ?? undefined,
            frame_time: asset.frame_time ?? undefined,
            duration: asset.duration ?? undefined,
            source: (asset.source ?? undefined) as 'upload' | 'video_frame' | undefined,
          }
        }

        if (asset.type === ASSET_TYPE.BEAT) {
          mapped_track.beat = asset_with_url
        }
        if (asset.type === ASSET_TYPE.THUMBNAIL) {
          mapped_track.thumbnail = asset_with_url
        }
        if (asset.type === ASSET_TYPE.STEM) {
          mapped_track.stem = asset_with_url
        }
        if (asset.type === ASSET_TYPE.VIDEO_LOOP) {
          mapped_track.video_loop = asset_with_url
        }
      }
    )
  )

  return mapped_track

}

export const db_asset_to_asset = async (db_asset: DbAsset, url?: string): Promise<Asset> => {
  let _url = url
  if (_url === undefined) {
    _url = await getSignedFileUrl(db_asset.s3_key)
  }

  return {
    id: db_asset.id,
    name: db_asset.name,
    type: db_asset.type as AssetType,
    url: _url,
    s3_uploaded: true,
    bs_uploaded: db_asset.beatstars_id !== null,
    crop: db_asset.crop_data ? db_asset.crop_data as CropData : undefined,
    mimetype: db_asset.mimetype ?? undefined,
    frame_time: db_asset.frame_time ?? undefined,
    duration: db_asset.duration ?? undefined,
    source: (db_asset.source ?? undefined) as 'upload' | 'video_frame' | undefined,
  }
}

export const db_profile_connection_to_connection = async (
  db_profile_connection: DbProfileConnection,
): Promise<ProfileConnection> => {
  const base = {
    id: db_profile_connection.id,
    id_profile: db_profile_connection.id_profile,
    created_at: db_profile_connection.created_at,
  }

  switch (db_profile_connection.platform) {
    case PLATFORMS.YOUTUBE:
      return {
        ...base,
        platform: PLATFORMS.YOUTUBE,
        meta: db_profile_connection.meta as YoutubeMeta,
      }
    case PLATFORMS.BEATSTARS: {
      const stored_meta = db_profile_connection.meta as BeatstarsMeta
      let stems_available = false
      try {
        const token = await get_beatstars_token(db_profile_connection.id_profile)
        const caps = await get_bs_member_capabilities(token)
        stems_available = caps.stems_available
      } catch {
        stems_available = false
      }
      return {
        ...base,
        platform: PLATFORMS.BEATSTARS,
        meta: { ...stored_meta, stems_available },
      }
    }
    default:
      throw new Error(`Unknown platform: ${db_profile_connection.platform}`)
  }
}

export const db_profile_to_profile = async (
  db_profile: DbProfile,
): Promise<Profile> => {
  return {
    id: db_profile.id,
    id_user: db_profile.id_user,
    name: db_profile.name,
    settings: db_profile.settings as Settings,
    connections: await Promise.all(
      db_profile.profile_connections.map(
        conn => db_profile_connection_to_connection(conn)
      )
    )
  }

}
