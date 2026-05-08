import express from 'express'
import bcrypt from 'bcrypt'

import { api_error400, api_error401, ApiError } from '../errors'
import { db } from '../db'

export const auth_router = express.Router()

auth_router.post('/login', async (req, res, next) => {
  try {
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
      return api_error401('Invalid credentials')
    }
    const valid_password = await bcrypt.compare(password, user.password);
    if (!valid_password) {
      return api_error401('Invalid credentials')
    }

    req.session.userId = user.id;
    return res.status(200).send({ success: true })
  } catch (err) {
    next(err)
  }
})


auth_router.get('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) {
      return next(new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Logout failed'));
    }

    res.clearCookie('bosko_session', {
      path: '/',
    });

    res.status(200).json({ message: 'Logged out' });
  });
});
