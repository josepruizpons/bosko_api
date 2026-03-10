import express from 'express'
import multer from 'multer';
import sharp from 'sharp';
import { asyncHandler, generate_id, get_current_user, get_profile } from "../utils";
import { api_error400, api_error404 } from '../errors';
import { uploadFileToS3, streamFileFromS3 } from "../aws";
import { db } from '../db'
import { ASSET_TYPE } from '../constants';
import { db_asset_to_asset } from '../mappers';
import { unlink } from 'fs/promises';

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

    let uploadPath = file.path;
    let uploadMimetype = mimetype;
    let assetName = file.originalname;
    let convertedPath: string | null = null;

    // Convert image to PNG if it's not already PNG
    if (type === ASSET_TYPE.THUMBNAIL && mimetype !== 'image/png') {
      const baseName = assetName.replace(/\.[^.]+$/, '');
      convertedPath = `/tmp/uploads/${Date.now()}_${baseName}.png`;
      await sharp(file.path).png().toFile(convertedPath);
      uploadPath = convertedPath;
      uploadMimetype = 'image/png';
      assetName = `${baseName}.png`;
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
