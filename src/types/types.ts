import {ASSET_TYPE} from '../constants'
export type EnumOptions<T> = T[keyof T];
export type Track = {
  id: string;
  name: string;
  id_user: number;
  id_beat: string;
  id_thumbnail: string;
  yt_url: string;
  created_at: Date;
}

type AssetType = EnumOptions<typeof ASSET_TYPE>
export type Asset = {
  id: string;
  name: string;
  type: AssetType;
  beatstars_id: string;
  created_at: Date;
}
