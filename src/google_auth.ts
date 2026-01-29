import { google } from 'googleapis'
import { db } from './db'
import { api_error500 } from './errors'
import { CONNECTION_TYPES, PROD_HOSTNAME } from './constants'




export const get_google_client = async (user_id: number) => {
  const oauth = await db.oauth.findFirst({
    where: {
      connection_type: CONNECTION_TYPES.YOUTUBE,
      id_user: user_id,
    }
  })
  if (oauth === null) {
    console.log({
      message: `${CONNECTION_TYPES.YOUTUBE} oauth not found`
    })
    api_error500(`${CONNECTION_TYPES.YOUTUBE} oauth not found`)
  }
  const callback_endpoint = process.env.NODE_ENV === "production"
    ? `${PROD_HOSTNAME}/api/google/auth_callback`
    : 'https://localhost:3000/api/google/auth_callback'


  const oauth2Client = new google.auth.OAuth2(
    oauth?.client_id,
    oauth?.client_secret,
    callback_endpoint,
  )

  // Establece refresh token
  oauth2Client.setCredentials({
    refresh_token: oauth?.refresh_token,
  })

  return oauth2Client
}
