export function isLocalhostBase(url) {
  return !url || /localhost|127\.0\.0\.1/i.test(url)
}

export function pathFromMediaUrl(url = '') {
  const match = String(url).match(/(\/media\/[^\s?#]+)/)
  return match ? match[1] : ''
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
  if (!buf || buf.length < 12) return false
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
