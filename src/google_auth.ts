import { google } from 'googleapis'
import { db } from './db'
import { api_error400, api_error500 } from './errors'
import { PLATFORMS, PROD_HOSTNAME } from './constants'




export const get_google_client = async (
  id_profile: string,
) => {
  const connection = await db.profile_connections.findFirst({
    where: {
      id_profile,
      platform: PLATFORMS.YOUTUBE,
    },
    include: { oauth: true }
  })

  if (!connection) {
    console.log({
      message: `${PLATFORMS.YOUTUBE} connection not found for profile ${id_profile}`
    })
    return api_error400(`Profile has no YouTube connection`)
  }

  const oauth = connection.oauth
  const callback_endpoint = process.env.NODE_ENV === "production"
    ? `${PROD_HOSTNAME}/google/auth_callback`
    : `https://localhost:3000/google/auth_callback`



  const oauth2Client = new google.auth.OAuth2(
    oauth.client_id,
    oauth.client_secret,
    callback_endpoint,
  )

  // Establece refresh token
  oauth2Client.setCredentials({
    refresh_token: oauth.refresh_token,
  })

  return oauth2Client
}
