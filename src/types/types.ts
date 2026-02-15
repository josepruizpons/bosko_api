import {ASSET_TYPE, TRACK_STATUS} from '../constants'
export type EnumOptions<T> = T[keyof T];

export type AssetType = EnumOptions<typeof ASSET_TYPE>
export type TrackStatus = EnumOptions<typeof TRACK_STATUS>

export type Asset = {
  id: string;
  name: string;
  type: AssetType;
  url: string;
  s3_uploaded: boolean;
  bs_uploaded: boolean;
}

export type Track = {
  id: string;
  status: TrackStatus,
  created_at: Date;
  name: string;
  beat: Asset | null,
  thumbnail: Asset | null,
  yt_url: string | null;
  beatstars_url: string | null;
  publish_at: Date;
  beatstars_id_track: string | null;
}
