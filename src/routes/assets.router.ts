import express from 'express'
import multer from 'multer';
import { asyncHandler, generate_id, get_current_user } from "../utils";
import { api_error400 } from '../errors';
import { uploadFileToS3 } from "../aws";
import { db } from '../db'
import { ASSET_TYPE } from '../constants';

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
    await get_current_user(req)

    const file = req.file;
    const type: string = req.body.type;

    if (!file || !file.buffer || file.size === 0) {
      return api_error400('Invalid file');
    }

    if (type !== 'beat' && type !== 'thumbnail') {
      return api_error400('Invalid type. Must be "beat" or "thumbnail"');
    }

    const mimetype = {
      'audio/vnd.wave': 'audio/wav',
    }[file.mimetype] ?? file.mimetype

    if (type === 'beat' && !VALID_AUDIO_TYPES.includes(mimetype)) {
      return api_error400('Invalid file type for beat. Must be audio file');
    }

    if (type === 'thumbnail' && !VALID_IMAGE_TYPES.includes(mimetype)) {
      return api_error400('Invalid file type for thumbnail. Must be image file');
    }

    const asset_type = type === 'beat' ? ASSET_TYPE.BEAT : ASSET_TYPE.THUMBNAIL;
    const s3_folder = type === 'beat' ? 'beats' : 'thumbnails';
    const s3_key = `${s3_folder}/${Date.now()}_${file.originalname}`;

    await uploadFileToS3(file.buffer, s3_key, mimetype);

    const id_asset = generate_id();
    const asset = await db.asset.create({
      data: {
        id: id_asset,
        name: file.originalname,
        type: asset_type,
        s3_key: s3_key,
        beatstars_id: null,
      }
    });

    res.status(201).json(asset);
  })
);
