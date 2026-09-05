import Jimp from 'jimp'
import { inspectImageBuffer } from './media-url.mjs'

const LIMITS = {
  post: { maxWidth: 1920, maxHeight: 1920, quality: 82 },
  social: { maxWidth: 1080, maxHeight: 1350, quality: 84 },
  reference: { maxWidth: 1600, maxHeight: 1600, quality: 82 }
}

export function jpegFilename(filename = 'imagen.jpg') {
  const base = String(filename || 'imagen.jpg').replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() || 'imagen.jpg'
  return base.replace(/\.[a-z0-9]+$/i, '') + '.jpg'
}

function flattenAlpha(image) {
  if (!image.hasAlpha()) return image
  const bg = new Jimp(image.bitmap.width, image.bitmap.height, 0xffffffff)
  return bg.composite(image, 0, 0)
}

export async function optimizeImageBuffer(buf, { kind = 'post', filename = 'imagen.jpg' } = {}) {
  const integrity = inspectImageBuffer(buf)
  if (!integrity.ok) {
    return { buffer: buf, filename, format: integrity.format, optimized: false, integrity }
  }

  let image
  try {
    image = await Jimp.read(buf)
  } catch {
    return {
      buffer: buf,
      filename,
      format: integrity.format,
      optimized: false,
      integrity
    }
  }

  const limits = LIMITS[kind] || LIMITS.post
  const resized =
    image.bitmap.width > limits.maxWidth || image.bitmap.height > limits.maxHeight
  if (resized) {
    image.scaleToFit(limits.maxWidth, limits.maxHeight)
  }
  image = flattenAlpha(image)
  const jpeg = await image.quality(limits.quality).getBufferAsync(Jimp.MIME_JPEG)
  if (integrity.format === 'jpeg' && !resized && jpeg.length >= buf.length) {
    return { buffer: buf, filename, format: 'jpeg', optimized: false, integrity }
  }
  return {
    buffer: jpeg,
    filename: jpegFilename(filename),
    format: 'jpeg',
    optimized: true,
    integrity,
    originalBytes: buf.length,
    outputBytes: jpeg.length
  }
}

/**
 * Thumbnail JPEG (max width). Keeps aspect ratio; flattens alpha onto white.
 */
export async function generateThumbBuffer(buf, maxWidth = 400) {
  const integrity = inspectImageBuffer(buf)
  if (!integrity.ok) {
    return { buffer: null, format: integrity.format, ok: false, integrity }
  }

  let image
  try {
    image = await Jimp.read(buf)
  } catch {
    return { buffer: null, format: integrity.format, ok: false, integrity }
  }

  if (image.bitmap.width > maxWidth) {
    image.scaleToFit(maxWidth, Jimp.AUTO)
  }
  image = flattenAlpha(image)
  const jpeg = await image.quality(78).getBufferAsync(Jimp.MIME_JPEG)
  return {
    buffer: jpeg,
    format: 'jpeg',
    ok: true,
    integrity,
    width: image.bitmap.width,
    height: image.bitmap.height,
    bytes: jpeg.length
  }
}
