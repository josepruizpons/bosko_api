import { PLATFORMS } from "../constants";
import { db } from "../db";
import { api_error400, api_error500 } from "../errors";
import { BeatStarsLoginResponse, BeatStarsTrack } from "../types/bs_types";
import { UserInfo } from "../types/types"
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

  if (response.status !== 200) api_error500()

  const payload: BeatStarsLoginResponse = await response.json()

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

  console.log({headers})


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
    console.log({errors: check_track_graphql_errors.messages.join(' - ')})
    return null
  }

  console.log(JSON.stringify(check_track_body, null, 2))

  return check_track_body.data.member.inventory.track
}
