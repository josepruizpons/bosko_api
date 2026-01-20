import express from 'express'
import bcrypt from 'bcrypt'

import { api_error400, api_error403 } from '../errors'
import { db } from '../db'

export const auth_router = express.Router()


auth_router.get('/check', async (req, res) => {
  const sessionId = req.cookies?.bosko_cookie;
  console.log(req.cookies)

  if (!sessionId) {
    return res.status(401).json({
      error: "No active session",
    });
  }

  return res.status(204).send()
})

auth_router.post('/login', async (req, res) => {
  console.log(req.body)
  const { email, password } = req.body ?? { email: undefined, password: undefined }
  if (
    typeof email != 'string'
  ) api_error400('Invalid email')
  if (
    typeof password != 'string'
  ) api_error400('Invalid password')

  console.log({ email, password })
  const user = await db.users.findFirst({
    where: {
      email,
    }
  })
  console.log({ user })

  if (user === null) {
    return api_error403('Invalid email')
  }
  const valid_password = await bcrypt.compare(password, user.password);
  if (!valid_password) {
    return api_error403('Invalid password')
  }

  res.cookie('bosko_cookie', '2', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,       // 🔑 importante
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });

  return res.status(200).send({ success: true })
})
