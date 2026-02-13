import express from 'express'
import multer from 'multer';
import { asyncHandler, generate_id, get_current_user } from "../utils";
import { api_error400, api_error404 } from '../errors';
import { uploadFileToS3, streamFileFromS3 } from "../aws";
import { db } from '../db'
import { ASSET_TYPE } from '../constants';
import { db_asset_to_asset } from '../mappers';

export const assets_router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
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

    const file = req.file;
    const type: string = req.body.type;

    if (!file || !file.buffer || file.size === 0) {
      return api_error400('Invalid file');
    }

    if (type !== ASSET_TYPE.BEAT && type !== ASSET_TYPE.THUMBNAIL) {
      return api_error400('Invalid type. Must be "beat" or "thumbnail"');
    }

    const mimetype = {
      'audio/vnd.wave': 'audio/wav',
    }[file.mimetype] ?? file.mimetype

    if (type === ASSET_TYPE.BEAT && !VALID_AUDIO_TYPES.includes(mimetype)) {
      return api_error400('Invalid file type for beat. Must be audio file');
    }

    if (type === ASSET_TYPE.THUMBNAIL && !VALID_IMAGE_TYPES.includes(mimetype)) {
      return api_error400('Invalid file type for thumbnail. Must be image file');
    }

    const asset_type = type
    const s3_folder = type === ASSET_TYPE.BEAT ? 'beats' : 'thumbnails';
    const s3_key = `${s3_folder}/${Date.now()}_${file.originalname}`;

    const url = await uploadFileToS3(file.buffer, s3_key, mimetype);

    const id_asset = generate_id();
    const db_asset = await db.asset.create({
      data: {
        id: id_asset,
        name: file.originalname,
        type: asset_type,
        s3_key: s3_key,
        mimetype: mimetype,
        id_user: user.id,
        beatstars_id: null,
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
