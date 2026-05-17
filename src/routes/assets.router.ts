import express from 'express'
import multer from 'multer';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { asyncHandler, generate_id, get_current_user, get_profile } from "../utils";
import { api_error400, api_error403, api_error404 } from '../errors';
import { uploadFileToS3, streamFileFromS3 } from "../aws";
import { db } from '../db'
import {
  ASSET_TYPE,
  MAX_VIDEO_LOOP_SECONDS_TOLERANCE,
  VALID_STEM_MIMETYPES,
  VALID_VIDEO_LOOP_MIMETYPES,
} from '../constants';
import { db_asset_to_asset } from '../mappers';
import { unlink } from 'fs/promises';
import type { CropData } from '../types/types';

const probe_duration = (path: string): Promise<number> =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) return reject(err)
      const duration = data.format?.duration
      if (typeof duration !== 'number' || Number.isNaN(duration)) {
        return reject(new Error('Could not determine duration'))
      }
      resolve(duration)
    })
  })

export const assets_router = express.Router()

const upload = multer({
  storage: multer.diskStorage({
    destination: '/tmp/uploads',
    filename: (_, file, cb) => {
      cb(null, `${Date.now()}_${file.originalname}`);
    }
  }),
  limits: {
    fileSize: 1024 * 1024 * 500 // 500MB
  }
});

const VALID_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/vnd.wave',
  'audio/x-wav',
  'audio/flac',
  'audio/ogg',
  'audio/mp3',
];

const VALID_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
];

// Upload asset
assets_router.post('/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)

    const id_profile: string | undefined = req.body.id_profile
    if (!id_profile) {
      return api_error400('Missing required field: id_profile')
    }

    await get_profile(user.id, id_profile)

    const file = req.file;
    const type: string = req.body.type;

    if (!file || !file.path || file.size === 0) {
      return api_error400('Invalid file');
    }

    if (
      type !== ASSET_TYPE.BEAT &&
      type !== ASSET_TYPE.THUMBNAIL &&
      type !== ASSET_TYPE.STEM &&
      type !== ASSET_TYPE.VIDEO_LOOP
    ) {
      return api_error400('Invalid type. Must be "BEAT", "THUMBNAIL", "STEM" or "VIDEO_LOOP"');
    }

    // Algunos navegadores no asignan mimetype al .zip (envían string vacío)
    const file_ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''
    const inferred_zip = (file.mimetype === '' || file.mimetype === 'application/octet-stream') && file_ext === 'zip'

    const mimetype = inferred_zip
      ? 'application/zip'
      : ({ 'audio/vnd.wave': 'audio/wav' }[file.mimetype] ?? file.mimetype)

    if (type === ASSET_TYPE.BEAT && !VALID_AUDIO_TYPES.includes(mimetype)) {
      return api_error400('Invalid file type for beat. Must be audio file');
    }

    if (type === ASSET_TYPE.THUMBNAIL && !VALID_IMAGE_TYPES.includes(mimetype)) {
      return api_error400('Invalid file type for thumbnail. Must be image file');
    }

    if (type === ASSET_TYPE.STEM && !VALID_STEM_MIMETYPES.includes(mimetype as typeof VALID_STEM_MIMETYPES[number])) {
      return api_error400('Invalid file type for stem. Must be a ZIP file');
    }

    if (
      type === ASSET_TYPE.VIDEO_LOOP &&
      !VALID_VIDEO_LOOP_MIMETYPES.includes(mimetype as typeof VALID_VIDEO_LOOP_MIMETYPES[number])
    ) {
      return api_error400(`Invalid file type for video loop. Must be one of: ${VALID_VIDEO_LOOP_MIMETYPES.join(', ')}`);
    }

    const asset_type = type
    const s3_folder =
      type === ASSET_TYPE.BEAT ? 'beats'
        : type === ASSET_TYPE.THUMBNAIL ? 'thumbnails'
          : type === ASSET_TYPE.VIDEO_LOOP ? 'video_loops'
            : 'stems';

    let uploadPath = file.path;
    let uploadMimetype = mimetype;
    let assetName = file.originalname;
    let convertedPath: string | null = null;
    let duration: number | null = null;

    // Convert image to PNG if it's not already PNG
    if (type === ASSET_TYPE.THUMBNAIL && mimetype !== 'image/png') {
      const baseName = assetName.replace(/\.[^.]+$/, '');
      convertedPath = `/tmp/uploads/${Date.now()}_${baseName}.png`;
      await sharp(file.path).png().toFile(convertedPath);
      uploadPath = convertedPath;
      uploadMimetype = 'image/png';
      assetName = `${baseName}.png`;
    }

    // Probe video/GIF duration and enforce the cap.
    if (type === ASSET_TYPE.VIDEO_LOOP) {
      try {
        duration = await probe_duration(file.path)
      } catch (err) {
        try { await unlink(file.path) } catch {}
        return api_error400('Could not read video duration. File may be corrupted.')
      }
      if (duration > MAX_VIDEO_LOOP_SECONDS_TOLERANCE) {
        try { await unlink(file.path) } catch {}
        return api_error400(`Video loop must be at most ${MAX_VIDEO_LOOP_SECONDS_TOLERANCE}s (got ${duration.toFixed(2)}s)`)
      }
    }

    const s3_key = `${s3_folder}/${Date.now()}_${assetName}`;

    // Upload file from disk using multipart upload
    const url = await uploadFileToS3(uploadPath, s3_key, uploadMimetype);

    // Clean up temp files
    const filesToDelete = convertedPath
      ? [file.path, convertedPath]
      : [file.path];

    for (const filePath of filesToDelete) {
      try {
        await unlink(filePath);
      } catch (err) {
        console.warn('Failed to delete temp file:', err);
      }
    }

    const raw_source: unknown = req.body.source
    let source: 'upload' | 'video_frame' | null = null
    if (type === ASSET_TYPE.THUMBNAIL) {
      source = raw_source === 'video_frame' ? 'video_frame' : 'upload'
    }

    const id_asset = generate_id();
    const db_asset = await db.asset.create({
      data: {
        id: id_asset,
        name: assetName,
        type: asset_type,
        s3_key: s3_key,
        mimetype: uploadMimetype,
        id_user: user.id,
        id_profile,
        beatstars_id: null,
        duration,
        source,
      }
    });

    const asset = await db_asset_to_asset(db_asset, url)
    res.status(201).json(asset);
  })
);

// Stream asset by ID
assets_router.get('/:id',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)

    const { id } = req.params;
    if (typeof id !== 'string') return api_error404('Asset not found')

    const asset = await db.asset.findUnique({
      where: { id }
    });

    if (!asset) {
      return api_error404('Asset not found');
    }

    // Verify asset belongs to user
    if (asset.id_user !== user.id) {
      return api_error404('Asset not found');
    }

    const { stream, contentType, contentLength } = await streamFileFromS3(asset.s3_key);

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    res.setHeader('Content-Disposition', `inline; filename="${asset.name}"`);

    // @ts-ignore - Node.js readable stream compatibility
    stream.pipe(res);
  })
);

// Guardar configuración de crop para un asset
assets_router.patch('/:id/crop',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id = req.params.id as string

    const asset = await db.asset.findUnique({ where: { id } })
    if (!asset) return api_error404('Asset not found')
    if (asset.id_user !== user.id) return api_error403('Forbidden')
    if (asset.type !== ASSET_TYPE.THUMBNAIL) return api_error400('Crop only applies to thumbnail assets')

    const { x, y, w, h } = req.body as CropData
    if (
      typeof x !== 'number' || typeof y !== 'number' ||
      typeof w !== 'number' || typeof h !== 'number' ||
      [x, y, w, h].some(v => v < 0 || v > 1)
    ) {
      return api_error400('Invalid crop values. x, y, w, h must be numbers between 0 and 1')
    }

    const crop_data: CropData = { x, y, w, h }
    const updated = await db.asset.update({
      where: { id },
      data: { crop_data },
    })

    const result = await db_asset_to_asset(updated)
    res.json(result)
  })
);

// Guardar el frame seleccionado del video loop
assets_router.patch('/:id/frame',
  asyncHandler(async (req, res) => {
    const user = await get_current_user(req)
    const id = req.params.id as string

    const asset = await db.asset.findUnique({ where: { id } })
    if (!asset) return api_error404('Asset not found')
    if (asset.id_user !== user.id) return api_error403('Forbidden')
    if (asset.type !== ASSET_TYPE.VIDEO_LOOP) return api_error400('frame_time only applies to VIDEO_LOOP assets')

    const { frame_time } = req.body as { frame_time: number }
    if (typeof frame_time !== 'number' || Number.isNaN(frame_time) || frame_time < 0) {
      return api_error400('Invalid frame_time. Must be a non-negative number')
    }
    const duration = asset.duration ?? MAX_VIDEO_LOOP_SECONDS_TOLERANCE
    if (frame_time > duration) {
      return api_error400(`frame_time (${frame_time}) exceeds video duration (${duration})`)
    }

    const updated = await db.asset.update({
      where: { id },
      data: { frame_time },
    })

    const result = await db_asset_to_asset(updated)
    res.json(result)
  })
);
