import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import path from 'path'
import { pathToFileURL } from 'url'

// Payload shared with bosko-publish's LambdaEvent.
export interface PublishPayload {
  job_id: string
  id_track: string
  id_user: number
  id_profile: string
  callback_url: string
  callback_token: string
  options: { yt_crop_thumbnail: boolean }
}

// When BOSKO_PUBLISH_LOCAL_PATH points to a local checkout of bosko-publish
// (and we're not in production), the publish job runs in-process instead of
// being dispatched to AWS Lambda. This lets us develop the whole pipeline
// locally — including the HMAC webhook → socket.io progress events.
const LOCAL_PUBLISH_PATH = process.env.BOSKO_PUBLISH_LOCAL_PATH
export const IS_LOCAL_PUBLISH = !!LOCAL_PUBLISH_PATH && process.env.NODE_ENV !== 'production'

const lambda_client = new LambdaClient({
  region: process.env.AWS_REGION || 'eu-west-3',
  credentials: {
    accessKeyId: process.env.AWS_ID!,
    secretAccessKey: process.env.AWS_SECRET_KEY!,
  },
})

if (IS_LOCAL_PUBLISH) {
  // The in-process handler calls back to our own HTTPS dev server. For that
  // fetch to trust the localhost cert, start the dev server with the mkcert
  // root CA exposed via NODE_EXTRA_CA_CERTS (see the "dev:local" npm script).
  console.warn(`[publish] LOCAL mode: bosko-publish runs in-process from ${LOCAL_PUBLISH_PATH}`)
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    console.warn(
      '[publish] NODE_EXTRA_CA_CERTS is not set — the localhost callback may fail TLS ' +
      'verification. Run via "npm run dev:local" or set NODE_EXTRA_CA_CERTS to your mkcert rootCA.pem.',
    )
  }

  // bosko-publish's S3 client uses the default AWS credential chain (the Lambda
  // IAM role in prod). In-process there's no role, so bridge bosko-api's
  // creds (custom env names) to the standard names the SDK expects.
  if (process.env.AWS_ID && process.env.AWS_SECRET_KEY) {
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ID
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_KEY
  } else {
    console.warn('[publish] AWS_ID/AWS_SECRET_KEY missing — S3 access will likely fail with 403.')
  }
}

type LambdaHandler = (event: PublishPayload) => Promise<unknown>
let cached_handler: LambdaHandler | null = null

async function load_local_handler(): Promise<LambdaHandler> {
  if (cached_handler) return cached_handler
  const handler_path = path.join(LOCAL_PUBLISH_PATH!, 'dist', 'handler.js')
  const mod = await import(pathToFileURL(handler_path).href)
  const handler = (mod.lambdaHandler ?? mod.handler) as LambdaHandler | undefined
  if (typeof handler !== 'function') {
    throw new Error(
      `No lambdaHandler export at ${handler_path}. Run "npm run build" in bosko-publish first.`,
    )
  }
  cached_handler = handler
  return handler
}

// Kicks off the publish job. Mirrors Lambda's InvocationType: 'Event' —
// returns as soon as the job is dispatched, never awaiting the full pipeline.
export async function invoke_publish(payload: PublishPayload): Promise<void> {
  if (IS_LOCAL_PUBLISH) {
    const handler = await load_local_handler() // throws if not built → caller reverts flags
    // fire-and-forget: the pipeline takes ~60s; don't block the HTTP response.
    void Promise.resolve()
      .then(() => handler(payload))
      .catch((e: unknown) => console.error('[publish:local] handler threw', e))
    return
  }

  await lambda_client.send(
    new InvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_PUBLISH_FUNCTION_NAME || 'bosko-publish',
      InvocationType: 'Event',
      Payload: JSON.stringify(payload),
    }),
  )
}
