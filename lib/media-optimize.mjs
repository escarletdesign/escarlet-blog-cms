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

// Jimp may carry JPEG APP1/APP13/COM segments through a decode/encode cycle.
// Remove EXIF (including GPS), XMP, IPTC, C2PA/JUMBF and comments explicitly
// before the image is stored or handed to a publishing provider. Keep APP0 /
// APP2 so the color profile and normal JPEG display metadata are not changed.
function stripJpegMetadata(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf
  const clean = [buf.subarray(0, 2)]
  let offset = 2
  while (offset + 3 < buf.length) {
    if (buf[offset] !== 0xff) {
      clean.push(buf.subarray(offset))
      break
    }
    let markerOffset = offset + 1
    while (markerOffset < buf.length && buf[markerOffset] === 0xff) markerOffset++
    if (markerOffset >= buf.length) break
    const marker = buf[markerOffset]
    const start = offset
    if (marker === 0xda) {
      clean.push(buf.subarray(start))
      break
    }
    if (marker === 0xd9 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      clean.push(buf.subarray(start, markerOffset + 1))
      offset = markerOffset + 1
      continue
    }
    if (markerOffset + 2 >= buf.length) break
    const segmentLength = buf.readUInt16BE(markerOffset + 1)
    const end = markerOffset + 1 + segmentLength
    if (segmentLength < 2 || end > buf.length) break
    const isPrivateMetadata = marker === 0xfe || marker === 0xe1 || marker === 0xeb || marker === 0xed
    if (!isPrivateMetadata) clean.push(buf.subarray(start, end))
    offset = end
  }
  return Buffer.concat(clean)
}

export async function optimizeImageBuffer(buf, { kind = 'post', filename = 'imagen.jpg' } = {}) {
  const integrity = inspectImageBuffer(buf)
  if (!integrity.ok) {
    return { buffer: buf, filename, format: integrity.format, optimized: false, metadataSanitized: false, integrity }
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
      metadataSanitized: false,
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
  const jpeg = stripJpegMetadata(await image.quality(limits.quality).getBufferAsync(Jimp.MIME_JPEG))
  return {
    buffer: jpeg,
    filename: jpegFilename(filename),
    format: 'jpeg',
    optimized: true,
    metadataSanitized: true,
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
