import express from 'express'
import { asyncHandler, beatstarsSlug, checkGraphQLErrors, extra_data_from_response, get_beatstars_token, get_current_user, sleep } from "../utils";
import { BeatStarsTrack } from "../types/bs_types";
import { api_error400, api_error403, api_error404, api_error500 } from '../errors';
import { downloadFileFromS3 } from "../aws";

import { db, track_include } from '../db'
import { db_asset_to_asset, db_track_to_track } from '../mappers';

export const bs_router = express.Router()

bs_router.post(
  '/upload',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)

    const id_asset: string | null = req.body.id_asset;
    if (id_asset === null) return api_error404('Asset not found')

    const db_asset = await db.asset.findUnique({
      where: {
        id: id_asset
      }
    })
    if (db_asset === null) return api_error404('Asset not found')

    const token = await get_beatstars_token(user.id);

    const beatstars_slug = beatstarsSlug(db_asset.name)

    const file = await downloadFileFromS3(db_asset.s3_key)

    /* --------------------------------------------------
       1) CREATE ASSET FILE (GraphQL)
    -------------------------------------------------- */

    const createAssetResponse = await fetch(
      "https://core.prod.beatstars.net/studio/graphql?op=createAssetFile",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          operationName: "createAssetFile",
          variables: {
            file: {
              fileName: beatstars_slug,
              contentType: db_asset.mimetype
            }
          },
          query: `
            mutation createAssetFile($file: FileUploadInput!) {
              create(file: $file) {
                id
                expirationDate
                file {
                  type
                  contentType
                }
              }
            }
          `
        })
      }
    );

    const assetBody = await createAssetResponse.json();
    console.log((JSON.stringify(assetBody, null, 2)))
    const assetErrors = checkGraphQLErrors(assetBody);
    if (assetErrors.hasErrors) {
      api_error500(assetErrors.messages.join(' | '));
      return;
    }

    const bs_asset = assetBody.data.create;

    /* --------------------------------------------------
       2) UPLOAD TO BEATSTARS S3
    -------------------------------------------------- */

    // Prepare BeatStars upload params
    const params = new URLSearchParams({
      filename: beatstars_slug,
      type: bs_asset.file.type,
      "metadata[asset-id]": bs_asset.id,
      "metadata[name]": beatstars_slug,
      "metadata[type]": bs_asset.file.type,
      "metadata[content-type]": db_asset.mimetype ?? 'image/png', // TODO: make mandatory field in db
      "metadata[version]": "2",
      // "metadata[user]": process.env.BS_USER_ID ?? "",
      "metadata[env]": "prod"
    });

    // Get BeatStars S3 params
    const s3ParamsRes = await fetch(
      `https://uppy-v4.beatstars.net/s3/params?${params.toString()}`
    );

    if (s3ParamsRes.status !== 200) {
      console.log(await s3ParamsRes.text())
      api_error500('Unable to get S3 params');
      return;
    }

    const { url, fields } = await s3ParamsRes.json();
    console.log({ url, fields: JSON.stringify(fields, null, 2) })

    // Prepare BeatStars upload form
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      form.append(key, value as string);
    });
    const blob = new Blob([file.buffer as unknown as BlobPart], { type: db_asset.mimetype ?? 'image/png' });
    form.append("file", blob, fields["x-amz-meta-name"]);

    // Upload to BeatStars
    const beatstarsUploadRes = await fetch(url, { method: "POST", body: form });

    // Check BeatStars upload result
    const text = await beatstarsUploadRes.text();
    console.log({ text: JSON.stringify(text, null, 2) })
    if (beatstarsUploadRes.status !== 201) {
      api_error500(`BeatStars S3 upload failed: ${text}`);
      return;
    }

    // Save beatstars_id to database
    const updated_asset = await db.asset.update({
      where: { id: id_asset },
      data: { beatstars_id: bs_asset.id }
    });


    const asset = await db_asset_to_asset(updated_asset, url)
    res.json(asset);
  })
);


bs_router.post('/publish',
  asyncHandler(
    async (req, res) => {
      const user = await get_current_user(req)

      const id_track: string = req.body.id_track

      if (typeof id_track !== 'string') {
        return api_error400('Missing required field: id_track')
      }

      // Buscar el track en la base de datos
      const track = await db.track.findUnique({
        where: { id: id_track }
      })

      if (track === null) {
        return api_error404('Track not found')
      }

      // Verificar que el track pertenece al usuario autenticado
      if (track.id_user !== user.id) {
        return api_error403('You do not have permission to publish this track')
      }

      // Idempotent: if already published on BeatStars, return existing share link
      if (track.beatstars_url) {
        return res.json({
          id_track: track.id,
          share_link: track.beatstars_url ?? null,
          beatstars_id_track: track.beatstars_id_track ?? null,
        })
      }

      // Verificar que el track tiene los assets necesarios
      if (!track.id_beat || !track.id_thumbnail) {
        return api_error400('Track is missing required assets: beat or thumbnail')
      }

      const beat_id_asset = track.id_beat
      const thumbnail_id_asset = track.id_thumbnail
      const track_name = track.name
      const publish_at = track.publish_at

      const publish_date = publish_at === null ? null : new Date(publish_at)
      if (publish_date !== null && isNaN(publish_date.getTime())) {
        return api_error400('Invalid publish_at date in track')
      }

      const beat = await db.asset.findUnique({
        where: {
          id: beat_id_asset,
        }
      })

      if (beat === null) {
        return api_error404('Beat not found')
      }

      const thumbnnail = await db.asset.findUnique({
        where: {
          id: thumbnail_id_asset,
        }
      })
      if (thumbnnail === null) {
        return api_error404('Thumbnnail not found')
      }


      const token = await get_beatstars_token(user.id)
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

      const beatstars_id_track = add_track_body.data.addTrack.id

      if (beat.beatstars_id === null) {
        return api_error400('Invalid beat: not uploaded')
      }

      if (thumbnnail.beatstars_id === null) {
        return api_error400('Invalid thumbnnail: not uploaded')
      }
      const attach_audio_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=attachMainAudio", {
        method: "POST",
        headers,
        body: JSON.stringify({
          "operationName": "attachMainAudio",
          "variables": {
            "id": beatstars_id_track,
            "assetId": beat.beatstars_id,
          },
          "query": "mutation attachMainAudio($id: String!, $assetId: String!) {\n  attachMainAudioFile(id: $id, assetId: $assetId, encodeRelatedFiles: false)\n}\n"
        }),
      })

      if (attach_audio_response.status !== 200) {
        api_error500((await extra_data_from_response(attach_audio_response)))
      }

      const attach_thumbnail_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=trackFormAttachArtwork", {
        method: "POST",
        headers,
        body: JSON.stringify({
          "operationName": "trackFormAttachArtwork",
          "variables": { "itemId": beatstars_id_track, "assetId": thumbnnail.beatstars_id },
          "query": "mutation trackFormAttachArtwork($itemId: String!, $assetId: String!) {\n  attachArtwork(itemId: $itemId, assetId: $assetId)\n}"
        }),
      })

      if (attach_thumbnail_response.status !== 200) {
        api_error500((await extra_data_from_response(attach_thumbnail_response)))
      }


      const raw = JSON.stringify({
        "operationName": "PublishTrackForm",
        "variables": {
          "id": beatstars_id_track,
          "track": {
            "category": "BEAT",
            "description": "",
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
              "bpmDouble": "220",
              "instruments": [],
              "keyNote": "NONE",
              "moods": []
            },
            "releaseDate": publish_date?.toISOString() ?? (new Date()).toISOString(),
            "thirdPartyLoopsAndSample": [],
            "title": track_name,
            "visibility": "PUBLIC",
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

      //NOTE: Check if audio is attached successfully -> bundle != null

      let has_bundle = false
      for (let retries = 1; retries > 0 && !has_bundle; retries--) {
        await sleep(5000)
        const check_track_response = await fetch("https://core.prod.beatstars.net/studio/graphql?op=GetTrack", {
          method: "POST",
          headers,
          body: JSON.stringify({
            "operationName": "GetTrack",
            "variables": {
              "id": beatstars_id_track
            },
            "query": "query GetTrack($id: String!) {\n  member {\n    id\n    inventory {\n      track(id: $id) {\n        ...trackForm\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment trackForm on Track {\n  ...trackFormTrackDetails\n  freeDownloadSettings {\n    enabled\n    fileType\n    mode\n    socialPlatforms {\n      beatStars\n      twitter\n      soundCloud\n      __typename\n    }\n    __typename\n  }\n  contentIdByTrackId {\n    ...trackFormContentIdDetails\n    __typename\n  }\n  collaborations {\n    ...trackFormCollaboration\n    __typename\n  }\n  metadata {\n    ...trackFormMetadata\n    __typename\n  }\n  artwork {\n    ...trackFormArtwork\n    __typename\n  }\n  profile {\n    ...trackFormMemberProfile\n    __typename\n  }\n  bundle {\n    ...trackFormBundle\n    __typename\n  }\n  thirdPartyLoopsAndSample {\n    title\n    source\n    __typename\n  }\n  voloco {\n    ...exposedTrackVolocoConfiguration\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormTrackDetails on Track {\n  id\n  description\n  title\n  visibility\n  status\n  releaseDate\n  category\n  created\n  excludeFromBulkDiscounts\n  url\n  shareUrl\n  proPageUrl\n  proPageShareUrl\n  customStream\n  openAIGenerationCount\n  __typename\n}\n\nfragment trackFormContentIdDetails on ContentIdTrack {\n  id\n  title\n  dsps {\n    ...trackFormDsp\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormDsp on ContentIdDsp {\n  id\n  name\n  status\n  logo {\n    name\n    bucket\n    url\n    assetId\n    __typename\n  }\n  icon {\n    name\n    bucket\n    url\n    assetId\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormCollaboration on Collaboration {\n  profitShare\n  publishingShare\n  ugcShare\n  role\n  status\n  guestCollaborator {\n    ...trackFormGuestCollaborator\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormGuestCollaborator on Profile {\n  displayName\n  memberId\n  avatar {\n    sizes {\n      small\n      __typename\n    }\n    fitInUrl(width: 100, height: 100)\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormMetadata on Metadata {\n  tags\n  genres {\n    key\n    value\n    __typename\n  }\n  moods {\n    key\n    value\n    __typename\n  }\n  moodValence {\n    key\n    value\n    __typename\n  }\n  keyNote {\n    key\n    value\n    __typename\n  }\n  instrumentation {\n    key\n    value\n    __typename\n  }\n  instruments {\n    key\n    value\n    __typename\n  }\n  vocalPresence {\n    key\n    value\n    __typename\n  }\n  vocalGender {\n    key\n    value\n    __typename\n  }\n  energy {\n    key\n    value\n    __typename\n  }\n  energyVariation {\n    key\n    value\n    __typename\n  }\n  exclusive\n  free\n  bpmDouble\n  __typename\n}\n\nfragment trackFormArtwork on Image {\n  fitInUrl(width: 300, height: 300)\n  assetId\n  sizes {\n    small\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormMemberProfile on Profile {\n  username\n  memberId\n  avatar {\n    assetId\n    fitInUrl(width: 100, height: 100)\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormBundle on TrackBundle {\n  progress\n  error\n  errorPart\n  mainAudioFile {\n    ...trackFormAudioFile\n    __typename\n  }\n  stemsFile {\n    ...trackFormBinaryFile\n    __typename\n  }\n  stream {\n    ...trackFormAudioFile\n    __typename\n  }\n  __typename\n}\n\nfragment trackFormAudioFile on Audio {\n  duration\n  extension\n  encode\n  assetId\n  name\n  fullName\n  url\n  type\n  signedUrl\n  size\n  __typename\n}\n\nfragment trackFormBinaryFile on Binary {\n  extension\n  assetId\n  name\n  fullName\n  url\n  type\n  signedUrl\n  size\n  contentType\n  __typename\n}\n\nfragment exposedTrackVolocoConfiguration on ExposedTrackVolocoConfiguration {\n  contentSharing {\n    existsInVoloco\n    optOut\n    __typename\n  }\n  __typename\n}\n"
          }),
          redirect: "follow"
        })

        const check_track_body: {
          data: {
            member: {
              inventory: {
                track: {
                  bundle: { progress: string } | null
                }
              }
            }
          }
        } = await check_track_response.json()
        const check_track_graphql_errors = checkGraphQLErrors(check_track_body)


        if (check_track_graphql_errors.hasErrors) {
          api_error500(check_track_graphql_errors.messages.join(' - '))
          return
        }

        const bundle = check_track_body.data.member.inventory.track.bundle
        if (bundle !== null && bundle.progress === 'ERROR') {
          api_error500('File audio error')
        }

        has_bundle = bundle !== null && bundle.progress === 'COMPLETE'
      }

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
      if (
        graphql_errors.hasErrors
        || !publish_track_body.data?.publishTrack?.shareUrl
      ) {
        console.log({ publish_errors: JSON.stringify(publish_track_body, null, 2) })
        api_error500(graphql_errors.messages.join(', '))
        return
      }

      const db_track = await db.track.update({
        where: { id: track.id },
        data: {
          beatstars_id_track,
          beatstars_url: publish_track_body.data.publishTrack.shareUrl,
        },
        include: track_include
      })

      const updated_track = await db_track_to_track(db_track)
      res.json(updated_track)
    }
  )
)
