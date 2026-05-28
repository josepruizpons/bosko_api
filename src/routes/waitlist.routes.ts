import express from 'express'

import { api_error400, api_error429 } from '../errors'
import { db } from '../db'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Simple in-memory rate limit: 10 requests per IP per 10 minutes.
// Process-local — for a multi-instance deploy upgrade to Redis or a CDN-level rule.
const WINDOW_MS = 10 * 60 * 1000
const MAX_HITS = 10
const hits = new Map<string, { count: number; windowStart: number }>()

const check_rate_limit = (ip: string) => {
  const now = Date.now()
  const entry = hits.get(ip)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now })
    return
  }
  entry.count += 1
  if (entry.count > MAX_HITS) {
    api_error429('Too many requests')
  }
}

export const waitlist_router = express.Router()

waitlist_router.post('/', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress
    ?? 'unknown'
  check_rate_limit(ip)

  const body = req.body ?? {}
  const email_raw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const locale_raw = typeof body.locale === 'string' ? body.locale : null
  const source_raw = typeof body.source === 'string' ? body.source : null

  if (!EMAIL_RE.test(email_raw) || email_raw.length > 320) {
    api_error400('Invalid email')
  }

  const locale = locale_raw === 'en' || locale_raw === 'es' ? locale_raw : null
  const source = source_raw && source_raw.length <= 64 ? source_raw : 'landing'

  await db.waitlist.upsert({
    where: { email: email_raw },
    create: { email: email_raw, locale, source },
    update: {},
  })

  res.json({ success: true })
})
