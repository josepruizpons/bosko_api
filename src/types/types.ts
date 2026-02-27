import { ASSET_TYPE, PLATFORMS, TRACK_STATUS } from '../constants'
export type EnumOptions<T> = T[keyof T];

export type AssetType = EnumOptions<typeof ASSET_TYPE>
export type TrackStatus = EnumOptions<typeof TRACK_STATUS>
export type Platform = EnumOptions<typeof PLATFORMS>

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
  thumbnail: Asset | null;
  yt_url: string | null;
  beatstars_url: string | null;
  publish_at: Date;
  beatstars_id_track: string | null;
}

export type Settings = Record<string, string> //TODO:


export type YoutubeMeta = {
  description: string;
}

export type BeatstarsMeta = {
  tags?: string[];
  genres?: string[];
  bpm?: string;
}

export type ProfileConnection = {
  id: string;
  id_profile: string;
  created_at: Date;
}
& (
    | { platform: typeof PLATFORMS.YOUTUBE, meta: YoutubeMeta }
    | { platform: typeof PLATFORMS.BEATSTARS, meta: BeatstarsMeta }
  )

export type Profile = {
  id: string;
  id_user: number;
  name: string;
  settings: Settings;
  connections: ProfileConnection[];
}

export type UserInfo = {
  id: number;
  email: string;
  is_active: boolean;
  created_at: Date;
  last_publish_at: Date | null;
  settings: Settings,
  profiles: Profile[];
}
