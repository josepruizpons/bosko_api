import express from 'express'
import crypto from 'crypto'
import { emit_to_user } from '../sockets'

export const webhooks_router = express.Router()

// Use raw body so the HMAC signature can be verified before JSON parsing.
webhooks_router.post(
  '/lambda-event',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res) => {
    const secret = process.env.LAMBDA_WEBHOOK_SECRET
    if (!secret) {
      console.error('[webhook] LAMBDA_WEBHOOK_SECRET not configured')
      return res.status(500).json({ error: 'webhook secret not configured' })
    }

    const sig_header = req.header('X-Lambda-Signature') ?? ''
    const provided = sig_header.startsWith('sha256=') ? sig_header.slice(7) : sig_header
    const body_buf = req.body as Buffer

    const expected = crypto.createHmac('sha256', secret).update(body_buf).digest('hex')

    let valid = false
    try {
      const a = Buffer.from(provided, 'hex')
      const b = Buffer.from(expected, 'hex')
      valid = a.length === b.length && crypto.timingSafeEqual(a, b)
    } catch {
      valid = false
    }

    if (!valid) {
      console.warn('[webhook] invalid HMAC signature')
      return res.status(401).json({ error: 'invalid signature' })
    }

    let payload: any
    try {
      payload = JSON.parse(body_buf.toString('utf-8'))
    } catch {
      return res.status(400).json({ error: 'invalid json' })
    }

    const { id_user, event, id_track, job_id, ts, data } = payload ?? {}
    if (typeof id_user !== 'number' || typeof event !== 'string') {
      return res.status(400).json({ error: 'missing id_user or event' })
    }

    // Local-only live tail: log every publish phase to the bosko-api dev terminal.
    // In production the AWS Lambda already streams to CloudWatch, so stay quiet.
    if (process.env.NODE_ENV !== 'production') {
      const detail = data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : ''
      console.log(`[publish:event] ${event} track=${id_track} job=${job_id}${detail}`)
    }

    emit_to_user(id_user, event, { id_track, job_id, ts, data })
    return res.status(204).send()
  },
)
