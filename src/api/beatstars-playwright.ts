import { chromium } from 'playwright'
import path from 'path'

const OAUTH_TOKEN_URL = 'https://core.prod.beatstars.net/auth/oauth/token'
const LOGIN_VERIFY_URL = 'https://oauth.beatstars.com/verify'
const CAPTURE_TIMEOUT_MS = 30_000
const PROFILE_DIR = path.resolve('./playwright-profile')

// Same UA BeatStars uses in its own requests
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0'

export interface BeatStarsOAuthResult {
  refresh_token: string
  client_id: string
  client_secret: string
}

export async function getBeatStarsTokensViaPlaywright(
  email: string,
  password: string
): Promise<BeatStarsOAuthResult> {
  // Persistent context: reuses cookies/localStorage across runs so BeatStars
  // recognises the "device" and skips verification codes after the first login
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    userAgent: USER_AGENT,
  })

  try {
    const page = await context.newPage()

    // Hide navigator.webdriver before any script on the page runs
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // Set up capture promise before navigating — must be ready before any request fires
    let resolveCapture!: (result: BeatStarsOAuthResult) => void
    let rejectCapture!: (err: Error) => void
    const capturePromise = new Promise<BeatStarsOAuthResult>((res, rej) => {
      resolveCapture = res
      rejectCapture = rej
    })

    page.on('request', (request) => {
      if (request.url() !== OAUTH_TOKEN_URL || request.method() !== 'POST') return

      const body = new URLSearchParams(request.postData() ?? '')
      if (body.get('grant_type') !== 'refresh_token') return

      const refresh_token = body.get('refresh_token') ?? ''
      const client_id = body.get('client_id') ?? ''
      const client_secret = body.get('client_secret') ?? ''

      if (!refresh_token || !client_id || !client_secret) {
        rejectCapture(new Error('OAuth request intercepted but missing required fields'))
        return
      }

      resolveCapture({ refresh_token, client_id, client_secret })
    })

    const timeout = new Promise<never>((_, rej) =>
      setTimeout(
        () => rej(new Error('BeatStars OAuth capture timed out after 30s — check credentials')),
        CAPTURE_TIMEOUT_MS
      )
    )

    // Step 1: navigate to verify page and fill email
    await page.goto(LOGIN_VERIFY_URL)
    await page.waitForSelector('#oath-email', { timeout: 10_000 })
    await page.fill('#oath-email', email)
    await page.click('button[type="submit"]')

    // Step 2: wait for login page and fill password
    await page.waitForURL('**/login', { timeout: 10_000 })
    await page.waitForSelector('#userPassword', { timeout: 10_000 })
    await page.fill('#userPassword', password)

    // Click submit — OAuth token request fires after this
    await page.click('button[type="submit"]')

    // Wait for the interceptor to capture the OAuth request
    const result = await Promise.race([capturePromise, timeout])

    return result
  } finally {
    await context.close()
  }
}
