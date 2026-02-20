import fs from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import crypto from 'crypto'

import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response as ExpressResponse } from "express";
import { api_error403, api_error500, ApiError } from "./errors";
import { BeatStarsLoginResponse, GraphQLResponse } from "./types/bs_types";
import { db } from './db';
import { Prisma } from './generated/prisma/client';
import { PLATFORMS, TRACK_STATUS } from './constants';
import { DbTrack } from './types/db_types';
import { Profile, TrackStatus, UserInfo } from './types/types';

export async function get_beatstars_token(user_id: number) {
  const bs_oauth = await db.oauth.findFirst({
    where: {
      connection_type: PLATFORMS.BEATSTARS,
      id_user: user_id,

    }
  })
  if (!bs_oauth) return api_error500()

  const urlencoded = new URLSearchParams();
  urlencoded.append("refresh_token", bs_oauth.refresh_token);
  urlencoded.append("client_id", bs_oauth.client_id);
  urlencoded.append("client_secret", bs_oauth.client_secret);
  urlencoded.append("grant_type", "refresh_token");
  const response = await fetch("https://core.prod.beatstars.net/auth/oauth/token", {
    method: 'POST',
    body: urlencoded,
  })

  if (response.status !== 200) api_error500()

  const payload: BeatStarsLoginResponse = await response.json()

  return payload.access_token
}

export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
    (req: Request, res: ExpressResponse, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

export const errorHandler: ErrorRequestHandler = (
  err,
  _,
  res,
  __
) => {
  if (err instanceof ApiError) {
    console.log({ err })
    res.status(err.status_code).json({
      error: err.code,
      message: err.message
    });
    return;
  }

  console.log(err)

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Error inesperado'
  });
};

export async function extra_data_from_response(response: Response) {
  const raw = await response.text();

  let body: any;

  try {
    body = JSON.parse(raw)
  } catch {
    body = raw
  }

  return JSON.stringify(
    {
      status: response.status,
      url: response.url,
      body,
    },
    null,
    2
  );
}
export function checkGraphQLErrors(response: GraphQLResponse): { hasErrors: boolean; messages: string[] } {
  const result = {
    hasErrors: false,
    messages: [] as string[],
  };

  if (response.errors && response.errors.length > 0) {
    result.hasErrors = true;
    result.messages = response.errors.map(err => {
      const path = err.path ? ` at path ${err.path.join(" > ")}` : "";
      return `${err.message}${path}`;
    });
  }

  return result;
}

export function buffer_to_stream(buffer: Buffer) {
  const { Readable } = require('stream')
  const stream = new Readable()
  stream.push(buffer)
  stream.push(null)
  return stream
}

export async function generate_video(audioBuffer: Buffer, imageBuffer: Buffer): Promise<Buffer> {
  const tempDir = 'temp'
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir)

  const audioPath = path.join(tempDir, `audio-${Date.now()}.mp3`)
  const imagePath = path.join(tempDir, `thumb-${Date.now()}.jpg`)
  const outputPath = path.join(tempDir, `video-${Date.now()}.mp4`)

  fs.writeFileSync(audioPath, audioBuffer)
  fs.writeFileSync(imagePath, imageBuffer)

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop 1'])
      .input(audioPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('192k')
      .outputOptions([
        '-tune stillimage',
        '-shortest',
        '-pix_fmt yuv420p',
        '-r 1', // 1 fps
        '-preset veryfast', // menor uso de RAM/CPU
        '-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black'
      ])
      .size('1920x1080')
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  })

  const buffer = fs.readFileSync(outputPath)

  fs.unlinkSync(audioPath)
  fs.unlinkSync(imagePath)
  fs.unlinkSync(outputPath)

  return buffer
}
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));



export function beatstarsSlug(input: string): string {
  return input
    // pasar a minúsculas
    .toLowerCase()

    // normalizar acentos (á → a, ñ → n, etc.)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

    // reemplazar & por 'and' (beatstars suele hacerlo)
    .replace(/&/g, "and")

    // eliminar todo lo que no sea letras, números o espacios
    .replace(/[^a-z0-9\s-]/g, "")

    // reemplazar espacios y guiones múltiples por un solo guión
    .replace(/[\s-]+/g, "-")

    // quitar guiones al inicio o final
    .replace(/^-+|-+$/g, "");
}

export async function get_current_user(req: Request) {
  const id_user = req.session.userId ?? -1
  const user = await db.users.findUnique({
    where: {
      id: id_user
    }
  })

  if (!user) api_error403('User not found')
  return user as Prisma.usersModel

}

export async function get_profile(id_user: Profile['id_user'], id_profile: Profile['id'])


const characterSet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

export function generate_id(length = 11) {
  const bytes = crypto.randomBytes(length);
  let result = '';

  for (let i = 0; i < length; i++) {
    result += characterSet[bytes[i] % characterSet.length];
  }

  return result;
}

export function youtubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function compute_track_status(db_track: DbTrack): TrackStatus {

  if (db_track.yt_url !== null) return TRACK_STATUS.YT_PUBLISHED
  if (db_track.beatstars_url !== null) return TRACK_STATUS.BS_PUBLISHED
  if (db_track.beat && db_track.thumbnail) {
    if (db_track.beat.beatstars_id && db_track.thumbnail.beatstars_id) {
      return TRACK_STATUS.BS_UPLOADED
    }

    return TRACK_STATUS.LINKED_ASSETS
  }

  return TRACK_STATUS.DRAFT
}
