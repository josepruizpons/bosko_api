
export type BeatStarsLoginResponse = {
  access_token: string
  token_type: 'bearer'
  refresh_token: string
  expires_in: number
  scope: string
  jti: string
}

export type BeatStarsAssetFile = {
  id: string;
  assetStatus: 'DRAFT';
  created:string;
  expirationDate: string;
  file: {
    assetId: string;
    name: string;
    fullName: string;
    contentType: string;
    access: 'PRIVATE';
    extension: string;
    type: 'AUDIO';
    url: string;
    signedUrl: string;
  }
}

export type BeatStarsS3UploadMeta = {
  acl: string;
  key: string;
  success_action_status: string;
  'content-type': 'AUDIO';
  'x-amz-meta-asset-id': string;
  'x-amz-meta-name': string;
  'x-amz-meta-type': string;
  'x-amz-meta-content-type': string;
  'x-amz-meta-version': string;
  'x-amz-meta-user': string;
  'x-amz-meta-env': string;
  bucket: 'bts-content';
  'X-Amz-Algorithm': string;
  'X-Amz-Credential': string;
  'X-Amz-Date': string;
  'X-Amz-Security-Token': string;
  'Policy': string;
  'X-Amz-Signature': string;
}

export type BeatStarsArtwork = {
  assetId: BeatStarsAssetFile['id'],
  fitInUrl: string;
}

export type BeatStarsBundle = {
  progress: 'COMPLETE' | 'PENDING' | 'ERROR';
  mainAudioFile: {
    extension: string;
    assetId: BeatStarsAssetFile['id'],
    name: string;
    fullName: string;
    url: string;
    type: 'AUDIO';
    signedUrl: string;
    size: number;
  }
  stream: {
    duration: number;
    extension: string;
    assetId: BeatStarsAssetFile['id'];
    url: string;
  }
}

export type BeatStarsTrack = {
  id: string;
  description: string;
  title: string;
  visibility: "PUBLIC" | "PRIVATE";
  status: "PUBLISHED" | "DRAFT";
  releaseDate: string; // ISO
  category: "BEAT";
  created: string; // ISO
  excludeFromBulkDiscounts: boolean;
  url: string;
  shareUrl: string;
  proPageUrl: string | null;
  proPageShareUrl: string | null;
  customStream: string | null;
  openAIGenerationCount: number;
  contentIdByTrackId: string | null;
  collaborations: unknown[];
  thirdPartyLoopsAndSample: unknown[];
  artwork: BeatStarsArtwork | null;
  bundle: BeatStarsBundle | null;
  // NOTE: Some fields have not been typed
}

export type GraphQLResponse = {
  data?: any;
  errors?: Array<{
    message: string;
    locations?: { line: number; column: number }[];
    path?: string[];
    extensions?: Record<string, any>;
  }>;
};

