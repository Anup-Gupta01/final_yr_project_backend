import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import multer from 'multer'
import { badRequest } from '../utils/AppError.js'

/**
 * Property image uploads, stored on the API server's disk under
 * /uploads/properties and served statically. Only real image types are
 * accepted, capped in size and count.
 */
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads')
const PROPERTY_DIR = path.join(UPLOAD_ROOT, 'properties')
fs.mkdirSync(PROPERTY_DIR, { recursive: true })

const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
export const MAX_FILES = 6
export const MAX_BYTES = 5 * 1024 * 1024

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROPERTY_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${TYPES[file.mimetype]}`),
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (TYPES[file.mimetype]) return cb(null, true)
    return cb(badRequest('Only JPG, PNG or WebP images are allowed.', { images: 'Unsupported file type.' }, 'UNSUPPORTED_FILE'))
  },
})

/** Wraps multer so its errors come out in the API's normal error shape. */
export function propertyImages(req, res, next) {
  upload.array('images', MAX_FILES)(req, res, (error) => {
    if (!error) return next()
    if (error.code === 'LIMIT_FILE_SIZE') return next(badRequest('Each image must be 5 MB or smaller.', { images: 'File too large.' }, 'FILE_TOO_LARGE'))
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest(`Upload at most ${MAX_FILES} images at a time.`, { images: 'Too many files.' }, 'TOO_MANY_FILES'))
    return next(error)
  })
}
