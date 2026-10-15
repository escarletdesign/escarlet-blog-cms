import Jimp from 'jimp'
import { compositionForAssetType } from './brand-kit.mjs'
import { inspectImageBuffer } from './media-url.mjs'

const NORMALIZABLE_ASSET_TYPES = new Set(['blog_cover', 'social_image', 'instagram_story', 'x_image', 'presentation'])
export const IMAGE_ASPECT_TOLERANCE = 0.03

function dimensionsFor(assetType) {
  const [width, height] = String(compositionForAssetType(assetType).dimensions || '').split('x').map(Number)
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw Object.assign(new Error(`No hay dimensiones objetivo para ${assetType}.`), { code: 'IMAGE_DIMENSIONS_UNAVAILABLE' })
  }
  return { width, height }
}

export function assertImageAspectCompatible(width, height, assetType, tolerance = IMAGE_ASPECT_TOLERANCE) {
  const target = dimensionsFor(assetType)
  const sourceWidth = Number(width)
  const sourceHeight = Number(height)
  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = target.width / target.height
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1 || !Number.isFinite(sourceRatio) || Math.abs(sourceRatio - targetRatio) / targetRatio > tolerance) {
    throw Object.assign(new Error(`La proporción ${width}x${height} no es compatible con ${assetType} (${target.width}x${target.height}).`), {
      status: 409,
      code: 'GENERATED_IMAGE_ASPECT_MISMATCH',
      expectedDimensions: `${target.width}x${target.height}`,
      receivedDimensions: `${width}x${height}`,
      sourceAspectRatio: Number.isFinite(sourceRatio) ? sourceRatio : null,
      targetAspectRatio: targetRatio,
      aspectTolerance: tolerance
    })
  }
  return target
}

export async function normalizeGeneratedImage(buffer, assetType, { autoNormalize = true } = {}) {
  const source = inspectImageBuffer(buffer)
  if (!source.ok || !source.width || !source.height) {
    throw Object.assign(new Error('El archivo generado no es una imagen válida.'), { status: 400, code: 'GENERATED_IMAGE_INVALID', image: source })
  }
  if (!NORMALIZABLE_ASSET_TYPES.has(assetType)) return { buffer, source, final: source, normalized: false }

  const target = assertImageAspectCompatible(source.width, source.height, assetType)
  if (source.width === target.width && source.height === target.height) return { buffer, source, final: source, normalized: false }
  if (!autoNormalize) {
    throw Object.assign(new Error(`Las dimensiones deben ser ${target.width}x${target.height}; se recibió ${source.width}x${source.height}.`), {
      status: 409,
      code: 'GENERATED_IMAGE_DIMENSIONS_MISMATCH',
      expectedDimensions: `${target.width}x${target.height}`,
      receivedDimensions: `${source.width}x${source.height}`
    })
  }
  if (!['png', 'jpeg'].includes(source.format)) {
    throw Object.assign(new Error(`La normalización automática admite PNG y JPG; se recibió ${source.format}.`), {
      status: 415,
      code: 'IMAGE_NORMALIZATION_UNSUPPORTED'
    })
  }

  let image
  try {
    image = await Jimp.read(buffer)
    image.cover(target.width, target.height, Jimp.HORIZONTAL_ALIGN_CENTER, Jimp.VERTICAL_ALIGN_MIDDLE)
    const mime = source.format === 'png' ? Jimp.MIME_PNG : Jimp.MIME_JPEG
    const normalizedBuffer = await image.getBufferAsync(mime)
    const final = inspectImageBuffer(normalizedBuffer)
    if (!final.ok || final.width !== target.width || final.height !== target.height) {
      throw Object.assign(new Error('No se pudo verificar la imagen normalizada.'), { code: 'IMAGE_NORMALIZATION_FAILED' })
    }
    return { buffer: normalizedBuffer, source, final, normalized: true }
  } catch (cause) {
    if (cause.code) throw cause
    throw Object.assign(new Error('No se pudo normalizar la imagen.'), { status: 400, code: 'IMAGE_NORMALIZATION_FAILED', cause })
  }
}
