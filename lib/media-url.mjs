import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mediaDir, readDb } from './db.mjs'
import { canonicalCmsPublicUrl } from './cms-url.mjs'
import { fetchRemote } from './remote-fetch.mjs'

export const MAX_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024

export function isLocalhostBase(url) {
  return !url || /localhost|127\.0\.0\.1/i.test(url)
}

export function pathFromMediaUrl(url = '') {
  const match = String(url).match(/(\/media\/[^\s?#]+)/)
  return match ? match[1] : ''
}

export function resolveImageSrc(imageUrl, { absolute = false } = {}) {
  const raw = String(imageUrl || '').trim()
  if (!raw) return ''

  const mediaPath = raw.startsWith('/media/') ? raw : pathFromMediaUrl(raw)
  if (mediaPath) {
    const safePath = mediaPath.startsWith('/') ? mediaPath : `/${mediaPath}`
    const base = canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL || '')
    if (absolute && base && !isLocalhostBase(base)) return `${base}${safePath}`
    return safePath
  }

  if (/^https?:\/\//i.test(raw) && !isLocalhostBase(raw)) return raw
  return raw
}

export function resolvePostImageSrc(imageUrl, site = 'escarlet') {
  const raw = String(imageUrl || '').trim()
  if (!raw) return ''
  const isRemote = /^https?:\/\//i.test(raw) && !isLocalhostBase(raw)

  const direct = resolveImageSrc(raw)
  if (direct.startsWith('/media/')) {
    const disk = join(mediaDir, direct.replace(/^\/media\//, ''))
    if (existsSync(disk)) return direct
  }

  const filename = basename(raw.split('?')[0])
  if (!filename) return direct.startsWith('/media/') ? direct : ''

  const diskCandidates = [
    join(mediaDir, site, filename),
    join(mediaDir, site, 'reference', filename),
    join(mediaDir, site, filename.replace(/\.webp$/i, '.png')),
    join(mediaDir, site, filename.replace(/\.png$/i, '.webp')),
    join(mediaDir, site, filename.replace(/\.jpe?g$/i, '.webp'))
  ]

  for (const disk of diskCandidates) {
    if (!existsSync(disk)) continue
    const rel = disk.slice(mediaDir.length).replace(/\\/g, '/')
    return `/media${rel}`
  }

  try {
    const db = readDb()
    const hit = (db.media || []).find(
      (item) =>
        item.site === site &&
        (item.filename === filename ||
          item.path?.endsWith(`/${filename}`) ||
          String(item.url || '').includes(filename))
    )
    if (hit) return resolveImageSrc(hit.path || hit.url)
  } catch {
    // ignore db read errors during image resolve
  }

  if (isRemote) return raw
  return direct.startsWith('/media/') ? direct : ''
}

export function repairPostsInDb(db) {
  if (!db?.posts?.length) return false
  let changed = false
  for (const post of db.posts) {
    if (!post.imageUrl) continue
    const next = resolvePostImageSrc(post.imageUrl, post.site || 'escarlet')
    if (next && next !== post.imageUrl) {
      post.imageUrl = next
      changed = true
    }
  }
  return changed
}

export function mediaForClient(item, { absolute = false } = {}) {
  if (!item) return item
  const path = item.path || pathFromMediaUrl(item.url)
  if (!path) return item

  const safePath = path.startsWith('/') ? path : `/${path}`
  const base = canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL || '')
  const abs = absolute && base && !isLocalhostBase(base)

  const next = {
    ...item,
    path: safePath,
    url: abs ? `${base}${safePath}` : safePath
  }

  const rawThumb = item.thumbPath || item.thumbUrl || ''
  if (rawThumb) {
    const thumbMedia = String(rawThumb).startsWith('/media/')
      ? String(rawThumb)
      : pathFromMediaUrl(rawThumb) || String(rawThumb)
    const safeThumb = thumbMedia.startsWith('/') ? thumbMedia : `/${thumbMedia}`
    next.thumbPath = safeThumb
    next.thumbUrl = abs ? `${base}${safeThumb}` : safeThumb
  }

  return next
}

export function repairMediaInDb(db) {
  if (!db?.media?.length) return false
  let changed = false
  db.media = db.media.map((item) => {
    const next = mediaForClient(item, { absolute: false })
    if (next.url !== item.url || next.path !== item.path) {
      changed = true
      return next
    }
    return item
  })
  return changed
}

export function decodeImageBase64(contentBase64) {
  let raw = String(contentBase64 || '').trim()
  if (!raw) return Buffer.alloc(0)
  if (/^https?:\/\//i.test(raw)) return null
  const dataUrl = raw.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,([\s\S]+)$/i)
  if (dataUrl) raw = dataUrl[1]
  raw = raw.replace(/\s/g, '')
  return Buffer.from(raw, 'base64')
}

/**
 * Rutas locales del sandbox de ChatGPT / code interpreter.
 * El CMS remoto no puede leerlas. Hay que usar contentBase64 o una URL http(s) pública.
 */
export function isSandboxOrLocalImageRef(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return false
  if (/^https?:\/\//i.test(raw)) return false
  if (/^(sandbox:|file:|chatgpt:\/\/|attachment:\/\/)/i.test(raw)) return true
  if (/^\/mnt\/data\b/i.test(raw)) return true
  if (/^\/(home|tmp|var\/folders|Users)\b/i.test(raw)) return true
  if (/^[A-Za-z]:\\/.test(raw)) return true
  if (/^\.?\.?\/[\w.-]+/.test(raw) && !raw.startsWith('/media/')) return true
  return false
}

export function sandboxImageHint(badRef = '') {
  const shown = String(badRef || '').trim().slice(0, 120)
  return [
    `La ruta "${shown}" es local del sandbox de ChatGPT. El CMS no puede abrirla.`,
    'Resuelve solo con mediaUpload A→B→C.',
    'content_upload_media. Adjunta file o usa contentBase64 o blob (PNG/JPG 2–3 MB).',
    'Si el host recorta, usa la misma tool con uploadId + chunkIndex + chunkCount (hasta 120000 caracteres).',
    'Prohibido curl, PUT y /mnt/data como imageUrl.'
  ].join(' ')
}

export function resolveLocalImagePath(value = '') {
  let raw = String(value || '').trim()
  if (!raw) return ''
  raw = raw.replace(/^sandbox:/i, '')
  raw = raw.replace(/^file:\/\//i, '')
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // keep raw
  }
  if (!raw || raw.includes('..')) return ''
  if (!raw.startsWith('/')) return ''
  if (!/\.(png|jpe?g|gif|webp)$/i.test(raw)) return ''
  return raw
}

export function pickBase64Payload(payload = {}) {
  const keys = ['contentBase64', 'blob', 'data', 'imageBase64', 'fileBase64', 'bytesBase64']
  for (const key of keys) {
    const value = payload[key]
    if (value && typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function readLocalImageFile(filePath) {
  const resolved = resolveLocalImagePath(filePath)
  if (!resolved || !existsSync(resolved)) return null
  const stat = statSync(resolved)
  if (!stat.isFile()) return null
  if (stat.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error('El archivo local supera 12 MB.')
  }
  return readFileSync(resolved)
}

const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
const MIN_IMAGE_BYTES = 32

function formatName(format) {
  if (format === 'webp') return 'WebP'
  if (format === 'jpeg') return 'JPG'
  if (format === 'png') return 'PNG'
  if (format === 'gif') return 'GIF'
  return 'imagen'
}

function jpegDimensions(buf) {
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buf[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buf.length) return null
    const length = buf.readUInt16BE(offset)
    if (length < 2 || offset + length > buf.length) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isSof && offset + 7 < buf.length) {
      return { width: buf.readUInt16BE(offset + 5), height: buf.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

function imageDimensions(buf, format) {
  if (format === 'png' && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (format === 'gif' && buf.length >= 10) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  if (format === 'jpeg') return jpegDimensions(buf)
  if (format === 'webp' && buf.length >= 30 && buf.slice(12, 16).toString('ascii') === 'VP8X') {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3)
    }
  }
  return null
}

function withDimensions(result, buf, format) {
  const dimensions = result.ok ? imageDimensions(buf, format) : null
  return {
    ...result,
    width: dimensions?.width || 0,
    height: dimensions?.height || 0,
    aspectRatio: dimensions?.width && dimensions?.height ? dimensions.width / dimensions.height : 0
  }
}

/**
 * Valida que el archivo sea una imagen completa, no solo la cabecera.
 * Un WebP truncado (RIFF declara 121 KB y llegan 15 KB) pasa el magic-byte
 * y el navegador muestra un recuadro vacío o el icono de imagen rota.
 */
export function inspectImageBuffer(buf) {
  const actualBytes = buf?.length || 0
  if (!buf || actualBytes < MIN_IMAGE_BYTES) {
    return {
      ok: false,
      format: '',
      actualBytes,
      declaredBytes: 0,
      width: 0,
      height: 0,
      aspectRatio: 0,
      reason: 'too_small'
    }
  }

  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46
  const isWebp =
    buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP'

  if (isWebp) {
    const declaredBytes = buf.readUInt32LE(4) + 8
    if (actualBytes < declaredBytes) {
      return withDimensions({ ok: false, format: 'webp', actualBytes, declaredBytes, reason: 'truncated' }, buf, 'webp')
    }
    return withDimensions({ ok: true, format: 'webp', actualBytes, declaredBytes, reason: '' }, buf, 'webp')
  }

  if (isPng) {
    const complete = buf.includes(PNG_IEND)
    return withDimensions({
      ok: complete,
      format: 'png',
      actualBytes,
      declaredBytes: complete ? actualBytes : 0,
      reason: complete ? '' : 'truncated'
    }, buf, 'png')
  }

  if (isJpeg) {
    const complete = buf.includes(Buffer.from([0xff, 0xd9]))
    return withDimensions({
      ok: complete,
      format: 'jpeg',
      actualBytes,
      declaredBytes: complete ? actualBytes : 0,
      reason: complete ? '' : 'truncated'
    }, buf, 'jpeg')
  }

  if (isGif) {
    const complete = buf.includes(0x3b)
    return withDimensions({
      ok: complete,
      format: 'gif',
      actualBytes,
      declaredBytes: complete ? actualBytes : 0,
      reason: complete ? '' : 'truncated'
    }, buf, 'gif')
  }

  return { ok: false, format: '', actualBytes, declaredBytes: 0, width: 0, height: 0, aspectRatio: 0, reason: 'unknown' }
}

export function looksLikeImage(buf) {
  return inspectImageBuffer(buf).ok
}

export function imageIntegrityMessage(info) {
  const bytes = info?.actualBytes || 0
  if (!info || info.ok) return ''
  if (info.reason === 'truncated' && info.declaredBytes) {
    return [
      `El ${formatName(info.format)} está incompleto.`,
      `El archivo declara ${info.declaredBytes} bytes y solo llegaron ${bytes}.`,
      'El navegador muestra un recuadro vacío o el icono de imagen rota.',
      'Vuelve a subir el archivo completo.',
      'Si el host recorta contentBase64, usa uploadId con chunkIndex y chunkCount.'
    ].join(' ')
  }
  if (info.reason === 'truncated') {
    return `El ${formatName(info.format)} está incompleto. Envía el archivo entero o súbelo a trozos con uploadId.`
  }
  if (info.reason === 'too_small') {
    return 'La imagen está vacía o truncada. Envía el archivo entero o súbelo a trozos con uploadId.'
  }
  return 'El archivo no es un PNG, JPG, GIF o WebP válido. Envía el archivo completo en contentBase64 o a trozos.'
}

export function coverImageError(imageUrl, site = 'escarlet') {
  const raw = String(imageUrl || '').trim()
  if (!raw) return ''
  const mediaPath = raw.startsWith('/media/') ? raw : pathFromMediaUrl(raw)
  if (!mediaPath) return ''
  const disk = join(mediaDir, mediaPath.replace(/^\/media\//, ''))
  if (!existsSync(disk)) {
    return 'La portada no está en el disco del CMS. Súbela otra vez con content_upload_media.'
  }
  const info = inspectImageBuffer(readFileSync(disk))
  if (info.ok) return ''
  return imageIntegrityMessage(info)
}

export async function bufferFromUpload({ contentBase64, imageUrl, filePath, buffer } = {}) {
  if (Buffer.isBuffer(buffer) && buffer.length) return buffer

  const urlCandidate = String(imageUrl || '').trim()
  const pathCandidate = String(filePath || '').trim()
  const b64Candidate = String(contentBase64 || '').trim()

  const localPath = resolveLocalImagePath(pathCandidate) || resolveLocalImagePath(urlCandidate)
  if (localPath) {
    const fromDisk = readLocalImageFile(localPath)
    if (fromDisk) return fromDisk
  }

  if (urlCandidate && isSandboxOrLocalImageRef(urlCandidate)) {
    if (b64Candidate && !isSandboxOrLocalImageRef(b64Candidate) && !/^https?:\/\//i.test(b64Candidate)) {
      return decodeImageBase64(b64Candidate)
    }
    throw new Error(sandboxImageHint(urlCandidate))
  }

  if (pathCandidate && isSandboxOrLocalImageRef(pathCandidate) && !b64Candidate) {
    throw new Error(sandboxImageHint(pathCandidate))
  }

  const remote =
    (/^https?:\/\//i.test(urlCandidate) ? urlCandidate : '') ||
    (/^https?:\/\//i.test(b64Candidate) ? b64Candidate : '')

  if (remote) {
    if (isSandboxOrLocalImageRef(remote)) throw new Error(sandboxImageHint(remote))
    const { response: res, body: buf } = await fetchRemote(remote, { maxBytes: MAX_IMAGE_UPLOAD_BYTES, timeoutMs: 15_000 })
    if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`)
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > 0 && buf.length < declared) {
      throw new Error(
        imageIntegrityMessage({
          ok: false,
          format: '',
          actualBytes: buf.length,
          declaredBytes: declared,
          reason: 'truncated'
        })
      )
    }
    return buf
  }

  if (b64Candidate && isSandboxOrLocalImageRef(b64Candidate)) {
    throw new Error(sandboxImageHint(b64Candidate))
  }

  return decodeImageBase64(contentBase64)
}
