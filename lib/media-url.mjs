import { existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mediaDir, readDb } from './db.mjs'

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
    const base = (process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')
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
  const base = (process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')

  if (absolute && base && !isLocalhostBase(base)) {
    return { ...item, path: safePath, url: `${base}${safePath}` }
  }

  return { ...item, path: safePath, url: safePath }
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

export function looksLikeImage(buf) {
  // Cabecera válida no basta. Un PNG truncado de 37 bytes engaña al navegador.
  if (!buf || buf.length < 1024) return false
  if (buf[0] === 0xff && buf[1] === 0xd8) return true
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true
  return false
}

export async function bufferFromUpload({ contentBase64, imageUrl }) {
  const remote = imageUrl || (String(contentBase64 || '').trim().match(/^https?:\/\//i) ? String(contentBase64).trim() : '')
  if (remote) {
    const res = await fetch(remote)
    if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }
  return decodeImageBase64(contentBase64)
}
