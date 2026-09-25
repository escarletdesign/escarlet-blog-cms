import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mediaDir, readDb, writeDb } from './db.mjs'
import { mediaForClient } from './media-url.mjs'
import { absoluteMediaUrl } from './preview-url.mjs'
import { canonicalCmsPublicUrl } from './cms-url.mjs'
import { collectUploadChunk, isChunkedUpload } from './upload-chunks.mjs'
import { pickBase64Payload } from './media-url.mjs'
import { pickConnectorFile } from './openai-file.mjs'
import { fetchRemote } from './remote-fetch.mjs'

const VIDEO_EXTENSIONS = new Set(['.webm', '.mp4', '.mov', '.m4v'])
const MIME_BY_EXT = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v'
}

export const VIDEO_MAX_UPLOAD_BYTES = Number(process.env.VIDEO_MAX_UPLOAD_BYTES || 200 * 1024 * 1024)
export const VIDEO_MAX_IMPORT_BYTES = Number(process.env.VIDEO_MAX_IMPORT_BYTES || 500 * 1024 * 1024)

export function sniffVideoMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm'
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii')
    if (brand === 'qt  ') return 'video/quicktime'
    return 'video/mp4'
  }
  return null
}

export function assertVideoBuffer(buffer, { declaredMime = '', filename = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('Falta el archivo de vídeo.'), { status: 400, code: 'VIDEO_INVALID_MIME' })
  }
  if (buffer.length > VIDEO_MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('El vídeo supera el tamaño máximo permitido.'), { status: 413, code: 'VIDEO_TOO_LARGE', extra: { maxBytes: VIDEO_MAX_UPLOAD_BYTES } })
  }
  const sniffed = sniffVideoMime(buffer)
  const extension = String(filename.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase()
  if (!sniffed) {
    throw Object.assign(new Error('El archivo no parece un vídeo WebM, MP4 o MOV válido.'), { status: 400, code: 'VIDEO_INVALID_MIME' })
  }
  const declared = String(declaredMime || '').split(';')[0].trim().toLowerCase()
  if (declared && !declared.startsWith('video/')) {
    throw Object.assign(new Error('El contentType declarado no es de vídeo.'), { status: 400, code: 'VIDEO_INVALID_MIME' })
  }
  if (extension && VIDEO_EXTENSIONS.has(extension) && MIME_BY_EXT[extension] && MIME_BY_EXT[extension] !== sniffed && !(extension === '.m4v' && sniffed === 'video/mp4')) {
    throw Object.assign(new Error('La extensión no coincide con el contenido del vídeo.'), { status: 400, code: 'VIDEO_INVALID_MIME' })
  }
  return sniffed
}

export function persistVideoFile({ site, filename, buffer, mimeType, format = 'portrait', role = 'source_video', alt = '', skipLegacyDb = true } = {}) {
  const sniffed = assertVideoBuffer(buffer, { declaredMime: mimeType, filename })
  const requestedName = basename(String(filename || '').replace(/[\\/]+/g, '-'))
  const extension = String(requestedName.match(/\.[a-z0-9]+$/i)?.[0] || '.webm').toLowerCase()
  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error('El archivo debe ser WebM, MP4, MOV o M4V.'), { status: 400, code: 'VIDEO_INVALID_MIME' })
  }
  const safeBase = requestedName.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() || `escarlet-video-${Date.now()}`
  const safeName = `${safeBase}-${Date.now()}${extension}`
  const dir = join(mediaDir, site)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, safeName), buffer)
  const urlPath = `/media/${site}/${safeName}`
  const publicUrl = canonicalCmsPublicUrl(absoluteMediaUrl(urlPath))
  const item = mediaForClient({
    id: `media-${Date.now()}-${randomUUID().slice(0, 8)}`,
    site,
    path: urlPath,
    alt,
    kind: 'video',
    filename: safeName,
    originalBytes: buffer.length,
    storedBytes: buffer.length,
    optimized: false,
    metadataSanitized: false,
    metadata: { format: format === 'landscape' ? 'landscape' : 'portrait', role },
    mimeType: sniffed,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    provenanceVersion: 'recorded'
  })
  if (!skipLegacyDb) {
    const db = readDb()
    db.media = db.media || []
    db.media.push(item)
    writeDb(db)
  }
  return { ...item, url: publicUrl, path: urlPath, publicUrl }
}

export async function resolveVideoUploadBuffer(payload = {}) {
  const connectorFile = pickConnectorFile(payload)
  const filename = payload.filename || connectorFile?.file_name || 'escarlet-video.webm'
  const contentBase64 = pickBase64Payload(payload)
  const hasBinary = Buffer.isBuffer(payload.buffer) && payload.buffer.length > 0
  if (isChunkedUpload(payload) && Number(payload.chunkCount) > 1) {
    const assembled = collectUploadChunk({
      uploadId: payload.uploadId,
      chunkIndex: payload.chunkIndex,
      chunkCount: payload.chunkCount,
      contentBase64,
      filename
    })
    if (!assembled.complete) return { awaitingChunks: true, ...assembled }
    return { buffer: Buffer.from(assembled.contentBase64, 'base64'), filename: assembled.filename || filename }
  }
  if (hasBinary) return { buffer: payload.buffer, filename }
  if (contentBase64) return { buffer: Buffer.from(contentBase64, 'base64'), filename }
  const remoteUrl = String(payload.sourceUrl || payload.videoUrl || connectorFile?.download_url || '').trim()
  if (remoteUrl) {
    const bytes = await fetchRemote(remoteUrl, { maxBytes: VIDEO_MAX_UPLOAD_BYTES })
    return { buffer: bytes, filename }
  }
  throw Object.assign(new Error('Falta el vídeo. Usa file, contentBase64, blob o trozos con uploadId.'), { status: 400, code: 'VIDEO_STORAGE_FAILED' })
}

export function videoImportAllowlistCheck(hostname) {
  const raw = String(process.env.VIDEO_IMPORT_URL_ALLOWLIST || '').trim()
  if (!raw) return true
  const allowed = raw.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  const host = String(hostname || '').toLowerCase()
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))
}
