import { PLATFORMS } from "../constants";
import { db } from "../db";
import { api_error400, api_error500 } from "../errors";
import { BeatstarsAudioAsset, BeatstarsImageAsset, BeatStarsLoginResponse, BeatStarsTrack } from "../types/bs_types";
import { DbAsset } from "../types/db_types";
import { Profile } from "../types/types";
import { checkGraphQLErrors } from "../utils"

export async function get_beatstars_token(id_profile: string) {
  const connection = await db.profile_connections.findFirst({
    where: {
      id_profile,
      platform: PLATFORMS.BEATSTARS,
    },
    include: { oauth: true }
  })

  if (!connection) return api_error400('Profile has no BeatStars connection')

  const bs_oauth = connection.oauth

  const urlencoded = new URLSearchParams();
  urlencoded.append("refresh_token", bs_oauth.refresh_token);
  urlencoded.append("client_id", bs_oauth.client_id);
  urlencoded.append("client_secret", bs_oauth.client_secret);
  urlencoded.append("grant_type", "refresh_token");
  const response = await fetch("https://core.prod.beatstars.net/auth/oauth/token", {
    method: 'POST',
    body: urlencoded,
  })

  if (response.status !== 200) return api_error500('BeatStars token refresh failed — reconnect your BeatStars account')

  const payload: BeatStarsLoginResponse = await response.json()

  // Auto-rotate: BeatStars issues a new refresh_token on each exchange; persist it
  if (payload.refresh_token && payload.refresh_token !== bs_oauth.refresh_token) {
    await db.oauth.update({ where: { id: bs_oauth.id }, data: { refresh_token: payload.refresh_token } })
  }

  return payload.access_token
}

export const get_bs_track_by_id = async (
  id_profile: string,
  bs_id_track: string,
) => {
  const token = await get_beatstars_token(id_profile)

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  }



  const check_track_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=GetTrack", {
    method: "POST",
    headers,
    body: JSON.stringify({
      "operationName": "GetTrack",
      "variables": {
        "id": bs_id_track,
      },
      "query": "query GetTrack($id: String!) {\n  member {\n    id\n    inventory {\n      track(id: $id) {\n        ...trackForm\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment trackForm on Track {\n  ...trackFormTrackDetails\n  freeDownloadSettings {\n    enabled\n    fileType\n    mode\n    socialPlatforms {\n      beatStars\n      twitter\n      soundCloud\n      __typename\n    }\n    __typename\n  }\n  contentIdByTrackId {\n    ...trackFormContentIdDetails\n    __typename\n  }\n  collaborations {\n    ...trackFormCollaboration\n    __typename\n  }\n  metadata {\n    ...trackFormMetadata\n    __typename\n  }\n  artwork {\n    ...trackFormArtwork\n    __typename\n  }\n  profile {\n    ...trackFormMemberProfile\n    __typename\n  }\n  bundle {\n    ...trackFormBundle\n    __typename\n  }\n  thirdPartyLoopsAndSample {\n    title\n    source\n    __typename\n  }\n  voloco {\n    ...exposedTrackVolocoConfiguration\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormTrackDetails on Track {\n  id\n  description\n  title\n  visibility\n  status\n  releaseDate\n  category\n  created\n  excludeFromBulkDiscounts\n  url\n  shareUrl\n  proPageUrl\n  proPageShareUrl\n  customStream\n  openAIGenerationCount\n  __typename\n}\n\nfragment trackFormContentIdDetails on ContentIdTrack {\n  id\n  title\n  dsps {\n    ...trackFormDsp\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormDsp on ContentIdDsp {\n  id\n  name\n  status\n  logo {\n    name\n    bucket\n    url\n    assetId\n    __typename\n  }\n  icon {\n    name\n    bucket\n    url\n    assetId\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormCollaboration on Collaboration {\n  profitShare\n  publishingShare\n  ugcShare\n  role\n  status\n  guestCollaborator {\n    ...trackFormGuestCollaborator\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormGuestCollaborator on Profile {\n  displayName\n  memberId\n  avatar {\n    sizes {\n      small\n      __typename\n    }\n    fitInUrl(width: 100, height: 100)\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormMetadata on Metadata {\n  tags\n  genres {\n    key\n    value\n    __typename\n  }\n  moods {\n    key\n    value\n    __typename\n  }\n  moodValence {\n    key\n    value\n    __typename\n  }\n  keyNote {\n    key\n    value\n    __typename\n  }\n  instrumentation {\n    key\n    value\n    __typename\n  }\n  instruments {\n    key\n    value\n    __typename\n  }\n  vocalPresence {\n    key\n    value\n    __typename\n  }\n  vocalGender {\n    key\n    value\n    __typename\n  }\n  energy {\n    key\n    value\n    __typename\n  }\n  energyVariation {\n    key\n    value\n    __typename\n  }\n  exclusive\n  free\n  bpmDouble\n  __typename\n}\n\nfragment trackFormArtwork on Image {\n  fitInUrl(width: 300, height: 300)\n  assetId\n  sizes {\n    small\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormMemberProfile on Profile {\n  username\n  memberId\n  avatar {\n    assetId\n    fitInUrl(width: 100, height: 100)\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormBundle on TrackBundle {\n  progress\n  error\n  errorPart\n  mainAudioFile {\n    ...trackFormAudioFile\n    __typename\n  }\n  stemsFile {\n    ...trackFormBinaryFile\n    __typename\n  }\n  stream {\n    ...trackFormAudioFile\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormAudioFile on Audio {\n  duration\n  extension\n  encode\n  assetId\n  name\n  fullName\n  url\n  type\n  signedUrl\n  size\n  __typename\n}\n\nfragment trackFormBinaryFile on Binary {\n  extension\n  assetId\n  name\n  fullName\n  url\n  type\n  signedUrl\n  size\n  contentType\n  __typename\n}\n\nfragment exposedTrackVolocoConfiguration on ExposedTrackVolocoConfiguration {\n  contentSharing {\n    existsInVoloco\n    optOut\n    __typename\n  }\n  __typename\n}\n"
    }),
    redirect: "follow"
  })

  const check_track_body: {
    data: {
      member: {
        inventory: {
          track: BeatStarsTrack
        }
      }
    }
  } = await check_track_response.json()
  const check_track_graphql_errors = checkGraphQLErrors(check_track_body)

  if (check_track_graphql_errors.hasErrors) {
    return null
  }

  return check_track_body.data.member.inventory.track
}

export const get_bs_image_by_id = async (
  id_profile: Profile['id'],
  bs_id_asset: DbAsset['beatstars_id']
) => {

  const token = await get_beatstars_token(id_profile)

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  }



  const asset_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=ThumbnailAssetById", {
    method: "POST",
    headers,
    body: JSON.stringify({
      "operationName": "ImageAssetById",
      "variables": {
        "assetId": bs_id_asset,
      },
      "query": "query ImageAssetById($assetId: String!) {\n  member {\n    assets {\n      image(assetId: $assetId) {\n        id\n        file {\n          assetId\n          name\n          signedUrl\n          __typename\n        }\n        fileExtension\n        fileType\n        signedUrl\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}"
    }),
    redirect: "follow"
  })

  const asset_image_body: {
    data: {
      member: {
        assets: {
          image: BeatstarsImageAsset;
        }
      }
    }
  } = await asset_response.json()
  const check_track_graphql_errors = checkGraphQLErrors(asset_image_body)

  if (check_track_graphql_errors.hasErrors) {
    console.log({ errors: check_track_graphql_errors.messages.join(' - ') })
    return null
  }

  return asset_image_body.data.member.assets.image
}


// Consulta el flag canUseStems del plan/cuenta BS. El campo vive en
// configuration.inventory.track.permissions.canUseStems — descubierto capturando
// la query `getMember` real del studio (scripts/capture-stems-upload.mjs).
export const get_bs_member_capabilities = async (token: string): Promise<{ stems_available: boolean }> => {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  }

  try {
    const response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=getStemsPermission", {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationName: "getStemsPermission",
        variables: {},
        query: "query getStemsPermission {\n  configuration {\n    inventory {\n      track {\n        permissions {\n          canUseStems\n          canUseStemsDisabledReason\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}",
      }),
      redirect: "follow"
    })

    const body: {
      data?: {
        configuration?: {
          inventory?: {
            track?: {
              permissions?: { canUseStems?: boolean; canUseStemsDisabledReason?: string | null }
            }
          }
        }
      }
    } = await response.json()

    const can_use_stems = body?.data?.configuration?.inventory?.track?.permissions?.canUseStems
    return { stems_available: can_use_stems ?? false }
  } catch {
    return { stems_available: false }
  }
}

// Devuelve el member id (formato "MR<numeric>"). Necesario para el metadata.user
// del flujo multipart de subida de stems.
export const get_bs_member_id = async (token: string): Promise<string> => {
  const res = await fetch('https://core.prod.beatstars.net/studio/graphql?op=getMemberId', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'getMemberId',
      variables: {},
      query: 'query getMemberId { member { id } }',
    }),
  })
  const body: { data?: { member?: { id?: string } } } = await res.json()
  const id = body?.data?.member?.id
  if (!id) api_error500('Failed to fetch BeatStars member id')
  return id
}

// Sube un buffer ZIP a BeatStars via el flujo multipart de uppy-v4. Devuelve cuando
// el upload se ha completado (parts ETags consolidados). El `asset_id` es el id
// devuelto por createAssetFile (que ya creó el slot de BINARY asset).
//
// Flujo capturado de studio.beatstars.com:
//   1. POST /s3/multipart                      → { uploadId, key }
//   2. GET  /s3/multipart/{uploadId}/{N}?key=… → { url } (presigned PUT)
//   3. PUT  <presignedUrl>                     → captura ETag
//   4. POST /s3/multipart/{uploadId}/complete?key=… body { parts }
export const upload_stem_to_beatstars_multipart = async (params: {
  token: string,
  member_id: string,
  asset_id: string,
  filename: string,
  file_buffer: Buffer,
}): Promise<void> => {
  const { token, member_id, asset_id, filename, file_buffer } = params
  const CHUNK_SIZE = 5 * 1024 * 1024 // 5 MB (mínimo S3 multipart, salvo última)

  const auth_headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // 1) Init multipart upload
  const init_res = await fetch('https://uppy-v4.beatstars.net/s3/multipart', {
    method: 'POST',
    headers: auth_headers,
    body: JSON.stringify({
      filename,
      type: 'application/zip',
      metadata: {
        'asset-id': asset_id,
        name: filename,
        type: 'BINARY',
        'content-type': 'application/zip',
        version: '2',
        user: member_id,
        env: 'prod',
      },
    }),
  })
  if (init_res.status !== 200) {
    api_error500(`stems multipart init failed (${init_res.status}): ${await init_res.text()}`)
  }
  const init_body: { uploadId: string; key: string } = await init_res.json()
  const { uploadId, key } = init_body
  const encoded_key = encodeURIComponent(key)

  // 2-3) Subir cada chunk con presigned PUT
  const total = Math.ceil(file_buffer.length / CHUNK_SIZE)
  const parts: { PartNumber: number; ETag: string }[] = []
  for (let i = 0; i < total; i++) {
    const part_number = i + 1
    const chunk = file_buffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)

    const presign_res = await fetch(
      `https://uppy-v4.beatstars.net/s3/multipart/${uploadId}/${part_number}?key=${encoded_key}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (presign_res.status !== 200) {
      api_error500(`stems multipart presign part ${part_number} failed (${presign_res.status}): ${await presign_res.text()}`)
    }
    const presign_body: { url: string } = await presign_res.json()

    const put_res = await fetch(presign_body.url, {
      method: 'PUT',
      body: new Blob([new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) as unknown as BlobPart]),
    })
    if (put_res.status !== 200) {
      api_error500(`stems multipart PUT part ${part_number} failed (${put_res.status})`)
    }
    const etag = put_res.headers.get('ETag') ?? put_res.headers.get('etag')
    if (!etag) api_error500(`stems multipart PUT part ${part_number} missing ETag header`)
    parts.push({ PartNumber: part_number, ETag: etag })
  }

  // 4) Complete
  const complete_res = await fetch(
    `https://uppy-v4.beatstars.net/s3/multipart/${uploadId}/complete?key=${encoded_key}`,
    {
      method: 'POST',
      headers: auth_headers,
      body: JSON.stringify({ parts }),
    },
  )
  if (complete_res.status !== 200) {
    api_error500(`stems multipart complete failed (${complete_res.status}): ${await complete_res.text()}`)
  }
}

export const get_bs_audio_by_id = async (
  id_profile: Profile['id'],
  bs_id_asset: DbAsset['beatstars_id']
) => {

  const token = await get_beatstars_token(id_profile)

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  }

  const asset_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=AudioAssetById", {
    method: "POST",
    headers,
    body: JSON.stringify({
      "operationName": "AudioAssetById",
      "variables": {
        "assetId": bs_id_asset,
      },
      "query": "query AudioAssetById($assetId: String!) {\n  member {\n    assets {\n      audio(assetId: $assetId) {\n        id\n        file {\n          assetId\n          name\n          signedUrl\n          __typename\n        }\n        fileExtension\n        fileType\n        signedUrl\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}"
    }),
    redirect: "follow"
  })

  const asset_audio_body: {
    data: {
      member: {
        assets: {
          audio: BeatstarsAudioAsset;
        }
      }
    }
  } = await asset_response.json()
  const check_track_graphql_errors = checkGraphQLErrors(asset_audio_body)

  if (check_track_graphql_errors.hasErrors) {
    console.log({ errors: check_track_graphql_errors.messages.join(' - ') })
    return null
  }

  return asset_audio_body.data.member.assets.audio
}
