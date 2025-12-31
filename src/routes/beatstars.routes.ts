import express from 'express'
import multer from 'multer';
import { asyncHandler, checkGraphQLErrors, extra_data_from_response, get_beatstars_token } from "../utils";
import { BeatStarsAssetFile, BeatStarsS3UploadMeta, BeatStarsTrack } from "../types";
import { api_error400, api_error500 } from '../errors';

export const bs_router = express.Router()

const upload = multer({ storage: multer.memoryStorage() });

bs_router.get('/login',
  asyncHandler(
    async (_, res) => {
      res.json({ token: (await get_beatstars_token()) })
    }
  ))

bs_router.post('/upload',
  upload.any(),
  asyncHandler(
    async (req, res) => {
      const file = (req.files as Express.Multer.File[])?.[0] ?? null
      if (file === null) api_error400('Invalid file')

      const token = await get_beatstars_token()

      const body = JSON.stringify({
        "operationName": "createAssetFile",
        "variables": {
          "file": {
            "fileName": file.originalname,
            "contentType": file.mimetype,
          }
        },
        "query": "mutation createAssetFile($file: FileUploadInput!) {\n  create(file: $file) {\n    id\n    assetStatus\n    created\n    expirationDate\n    file {\n      assetId\n      name\n      fullName\n      contentType\n      access\n      extension\n      type\n      url\n      size\n      universalFitInUrl\n      signedUrl\n      originalImageUrl\n      __typename\n    }\n    __typename\n  }\n}\n"
      });


      const asset_file_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=createAssetFile", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body,
      })

      if (asset_file_response.status !== 200) {
        const response = await asset_file_response.json()
        console.log('asset_file_response')
        api_error500(JSON.stringify(response))
      }
      const asset_file_body: {
        data: {
          create: BeatStarsAssetFile
        }
      } = await asset_file_response.json()
      console.log(JSON.stringify(asset_file_body, null, 2))
      const asset_file = asset_file_body.data.create



      const params = new URLSearchParams({
        filename: file.originalname,
        type: asset_file.file.type,
        // metadata tiene que codificarse con [ ] para que coincida con la API
        "metadata[asset-id]": asset_file.id,
        "metadata[name]": file.originalname,
        "metadata[type]": asset_file.file.type,
        "metadata[content-type]": asset_file.file.contentType,
        "metadata[version]": '2',
        "metadata[user]": process.env.BS_USER_ID ?? '',
        "metadata[env]": "prod",
      });

      const url = `https://uppy.beatstars.net/s3/params?${params.toString()}`;

      const s3_upload_response = await fetch(url)
      if (s3_upload_response.status !== 200) {
        const response = await s3_upload_response.json()
        console.log('s3_upload_response')
        api_error500(JSON.stringify(response))
      }

      const s3_upload_body: {
        method: 'post';
        url: string;
        fields: BeatStarsS3UploadMeta;
      } = await s3_upload_response.json()
      const s3_upload_meta = s3_upload_body.fields

      const formdata = new FormData();
      formdata.append("acl", s3_upload_meta.acl);
      formdata.append("key", s3_upload_meta.key);
      formdata.append("success_action_status", s3_upload_meta.success_action_status);
      formdata.append("content-type", s3_upload_meta["content-type"]);
      formdata.append("x-amz-meta-asset-id", s3_upload_meta["x-amz-meta-asset-id"]);
      formdata.append("x-amz-meta-name", s3_upload_meta["x-amz-meta-name"]);
      formdata.append("x-amz-meta-type", s3_upload_meta["x-amz-meta-type"]);
      formdata.append("x-amz-meta-content-type", file.mimetype);
      formdata.append("x-amz-meta-version", s3_upload_meta["x-amz-meta-version"]);
      formdata.append("x-amz-meta-user", s3_upload_meta["x-amz-meta-user"]);
      formdata.append("x-amz-meta-env", s3_upload_meta["x-amz-meta-env"]);
      formdata.append("bucket", s3_upload_meta.bucket);
      formdata.append("X-Amz-Algorithm", s3_upload_meta["X-Amz-Algorithm"]);
      formdata.append("X-Amz-Credential", s3_upload_meta["X-Amz-Credential"]);
      formdata.append("X-Amz-Date", s3_upload_meta["X-Amz-Date"]);
      formdata.append("X-Amz-Security-Token", s3_upload_meta["X-Amz-Security-Token"]);
      formdata.append("Policy", s3_upload_meta.Policy);
      formdata.append("X-Amz-Signature", s3_upload_meta["X-Amz-Signature"]);

      const blob = new Blob([new Uint8Array(file.buffer)], { type: "audio/wav" });
      formdata.append("file", blob, s3_upload_meta["x-amz-meta-name"]);

      const upload_file_response = await fetch("https://s3.us-east-1.amazonaws.com/bts-content", {
        method: "POST",
        body: formdata,
      })

      console.log('upload_file_response')
      if (upload_file_response.status !== 201) api_error500((await upload_file_response.text()))

      res.json({
        asset_file
      })
    }
  )
)


bs_router.post('/publish',
  asyncHandler(
    async (req, res) => {

      const track_name: string = req.body.name
      const id_asset: string = req.body.id_asset

      if (
        typeof track_name !== 'string'
        || typeof id_asset !== 'string'
      ) api_error400()

      const token = await get_beatstars_token()
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }


      const add_track_response = await fetch(
        "https://core.prod.beatstars.net/studio/graphql?op=AddTrack",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: "mutation AddTrack {\n  addTrack {\n    id\n    __typename\n  }\n}\n",
            variables: {}
          }),
          redirect: "follow"
        })

      if (add_track_response.status !== 200) {
        api_error500((await extra_data_from_response(add_track_response)))
      }

      const add_track_body: {
        data: {
          addTrack: {
            id: string
          }
        }
      } = await add_track_response.json()

      const id_track = add_track_body.data.addTrack.id


      const attach_audio_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=attachMainAudio", {
        method: "POST",
        headers,
        body: JSON.stringify({
          "operationName": "attachMainAudio",
          "variables": {
            "id": id_track,
            "assetId": id_asset,
          },
          "query": "mutation attachMainAudio($id: String!, $assetId: String!) {\n  attachMainAudioFile(id: $id, assetId: $assetId, encodeRelatedFiles: false)\n}\n"
        }),
      })

      if (attach_audio_response.status !== 200) {
        api_error500((await extra_data_from_response(add_track_response)))
      }

      const raw = JSON.stringify({
        "operationName": "PublishTrackForm",
        "variables": {
          "id": id_track,
          "track": {
            "category": "BEAT",
            "description": "bosko",
            "excludeFromBulkDiscounts": false,
            "metadata": {
              "tags": [
                "dancehall",
                "afrobeat",
                "tyla"
              ],
              "genres": [
                "AFRO",
                "AFROBEAT",
                "AFROPOP"
              ],
              "bpmDouble": 220,
              "instruments": [],
              "keyNote": "NONE",
              "moods": []
            },
            "releaseDate": new Date().toISOString(),
            "thirdPartyLoopsAndSample": [],
            "title": track_name,
            "visibility": "PRIVATE",
            "boostCampaign": false,
            "freeDownloadSettings": {
              "enabled": false,
              "fileType": "TAGGED_MP3",
              "mode": "EMAIL_CAPTURE",
              "socialPlatforms": {
                "beatStars": false,
                "soundCloud": false,
                "twitter": false
              }
            }
          },
          "collaborations": [],
          "contracts": []
        },
        "query": "mutation PublishTrackForm($id: String!, $track: TrackInput!, $contracts: [ContractAttachmentInput], $contentId: PrePublishedContentIdTrackInput, $collaborations: [CollaborationInput], $dsps: [Long]) {\n  publishTrack(\n    id: $id\n    track: $track\n    contracts: $contracts\n    contentId: $contentId\n    collaborations: $collaborations\n    dsps: $dsps\n  ) {\n    ...trackForm\n    __typename\n  }\n}\n\nfragment trackForm on Track {\n  ...trackFormTrackDetails\n  freeDownloadSettings {\n    enabled\n    fileType\n    mode\n    socialPlatforms {\n      beatStars\n      twitter\n      soundCloud\n      __typename\n    }\n    __typename\n  }\n  contentIdByTrackId {\n    ...trackFormContentIdDetails\n    __typename\n  }\n  collaborations {\n    ...trackFormCollaboration\n    __typename\n  }\n  metadata {\n    ...trackFormMetadata\n    __typename\n  }\n  artwork {\n    ...trackFormArtwork\n    __typename\n  }\n  profile {\n    ...trackFormMemberProfile\n    __typename\n  }\n  bundle {\n    ...trackFormBundle\n    __typename\n  }\n  thirdPartyLoopsAndSample {\n    title\n    source\n    __typename\n  }\n  voloco {\n    ...exposedTrackVolocoConfiguration\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormTrackDetails on Track {\n  id\n  description\n  title\n  visibility\n  status\n  releaseDate\n  category\n  created\n  excludeFromBulkDiscounts\n  url\n  shareUrl\n  proPageUrl\n  proPageShareUrl\n  customStream\n  openAIGenerationCount\n  __typename\n}\n\nfragment trackFormContentIdDetails on ContentIdTrack {\n  id\n  title\n  dsps {\n    ...trackFormDsp\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormDsp on ContentIdDsp {\n  id\n  name\n  status\n  logo {\n    name\n    bucket\n    url\n    assetId\n    __typename\n  }\n  icon {\n    name\n    bucket\n    url\n    assetId\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormCollaboration on Collaboration {\n  profitShare\n  publishingShare\n  ugcShare\n  role\n  status\n  guestCollaborator {\n    ...trackFormGuestCollaborator\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormGuestCollaborator on Profile {\n  displayName\n  memberId\n  avatar {\n    sizes {\n      small\n      __typename\n    }\n    fitInUrl(width: 100, height: 100)\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormMetadata on Metadata {\n  tags\n  genres {\n    key\n    value\n    __typename\n  }\n  moods {\n    key\n    value\n    __typename\n  }\n  moodValence {\n    key\n    value\n    __typename\n  }\n  keyNote {\n    key\n    value\n    __typename\n  }\n  instrumentation {\n    key\n    value\n    __typename\n  }\n  instruments {\n    key\n    value\n    __typename\n  }\n  vocalPresence {\n    key\n    value\n    __typename\n  }\n  vocalGender {\n    key\n    value\n    __typename\n  }\n  energy {\n    key\n    value\n    __typename\n  }\n  energyVariation {\n    key\n    value\n    __typename\n  }\n  exclusive\n  free\n  bpmDouble\n  __typename\n}\n\nfragment trackFormArtwork on Image {\n  fitInUrl(width: 300, height: 300)\n  assetId\n  sizes {\n    small\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormMemberProfile on Profile {\n  username\n  memberId\n  avatar {\n    assetId\n    fitInUrl(width: 100, height: 100)\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormBundle on TrackBundle {\n  progress\n  error\n  errorPart\n  mainAudioFile {\n    ...trackFormAudioFile\n    __typename\n  }\n  stemsFile {\n    ...trackFormBinaryFile\n    __typename\n  }\n  stream {\n    ...trackFormAudioFile\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormAudioFile on Audio {\n  duration\n  extension\n  encode\n  assetId\n  name\n  fullName\n  url\n  type\n  signedUrl\n  size\n  __typename\n}\n\nfragment trackFormBinaryFile on Binary {\n  extension\n  assetId\n  name\n  fullName\n  url\n  type\n  signedUrl\n  size\n  contentType\n  __typename\n}\n\nfragment exposedTrackVolocoConfiguration on ExposedTrackVolocoConfiguration {\n  contentSharing {\n    existsInVoloco\n    optOut\n    __typename\n  }\n  __typename\n}\n"
      });


      const publish_track_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=PublishTrackForm", {
        method: "POST",
        headers,
        body: raw,
        redirect: "follow"
      })

      const publish_track_body: {
        data?: {
          publishTrack: BeatStarsTrack | null;
        };
        errors?: any[];
      } = await publish_track_response.json();

      const graphql_errors = checkGraphQLErrors(publish_track_body)
      if (graphql_errors.hasErrors) {
        api_error500(graphql_errors.messages.join(' | '));
      }

      res.json({
        id_asset,
        id_track,
        share_link: publish_track_body.data?.publishTrack?.shareUrl,
      })
    }
  )
)
