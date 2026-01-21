import express from 'express'
import bcrypt from 'bcrypt'

import { api_error400, api_error403 } from '../errors'
import { db } from '../db'

export const auth_router = express.Router()

auth_router.post('/login', async (req, res) => {
  console.log(req.body)
  const { email, password } = req.body ?? { email: undefined, password: undefined }
  if (
    typeof email != 'string'
  ) api_error400('Invalid email')
  if (
    typeof password != 'string'
  ) api_error400('Invalid password')

  const user = await db.users.findFirst({
    where: {
      email,
    }
  })

  if (user === null) {
    return api_error403('Invalid email')
  }
  const valid_password = await bcrypt.compare(password, user.password);
  if (!valid_password) {
    return api_error403('Invalid password')
  }

  console.log({ user })
  req.session.userId = user.id;
  return res.status(200).send({ success: true })
})


auth_router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }

    res.clearCookie('bosko_session', {
      path: '/',
    });

    res.status(200).json({ message: 'Logged out' });
  });
});
