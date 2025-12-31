import fs from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response as ExpressResponse } from "express";
import { api_error500, ApiError } from "./errors";
import { BeatStarsLoginResponse, GraphQLResponse } from "./types";

export async function get_beatstars_token() {
  const urlencoded = new URLSearchParams();
  urlencoded.append("refresh_token", process.env.BS_REFRESH_TOKEN ?? '');
  urlencoded.append("client_id", process.env.BS_CLIENT_ID ?? '');
  urlencoded.append("client_secret", process.env.BS_CLIENT_SECRET ?? '');
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
      .outputOptions(['-tune stillimage', '-shortest', '-pix_fmt yuv420p'])
      .size('1280x720')
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
  })

  const buffer = fs.readFileSync(outputPath)

  fs.unlinkSync(audioPath)
  fs.unlinkSync(imagePath)
  fs.unlinkSync(outputPath)

  return buffer
}
