import { getSignedFileUrl } from "./aws";
import { ASSET_TYPE } from "./constants";
import { DbAsset, DbTrack } from "./types/db_types";
import { Asset, AssetType, Track } from "./types/types";
import { compute_track_status } from "./utils";

export const db_track_to_track = async (db_track: DbTrack): Promise<Track> => {

  const mapped_track: Track = {
    id: db_track.id,
    status: compute_track_status(db_track),
    name: db_track.name,
    created_at: db_track.created_at,
    publish_at: db_track.publish_at,
    yt_url: db_track.name,
    beatstars_url: db_track.beatstars_url,
    beat: null,
    thumbnail: null,
    beatstars_id_track: db_track.beatstars_id_track,
  }

  await Promise.all(
    [db_track.beat, db_track.thumbnail].map(
      async (asset) => {
        if (asset === null) return null
        const url = await getSignedFileUrl(asset.s3_key)
        const asset_with_url: Asset = {
          id: asset.id,
          name: asset.name,
          type: asset.type as AssetType,
          url,
          s3_uploaded: true,
          bs_uploaded: asset.beatstars_id !== null,
        }

        if (asset_with_url.type === ASSET_TYPE.BEAT) {
          mapped_track.beat = asset_with_url
        }
        if (asset_with_url.type === ASSET_TYPE.THUMBNAIL) {
          mapped_track.thumbnail = asset_with_url
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
  }
}
