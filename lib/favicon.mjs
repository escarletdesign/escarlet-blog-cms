import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Jimp from 'jimp'
import { Resvg } from '@resvg/resvg-js'
import { mediaDir } from './db.mjs'
import { absoluteMediaUrl } from './preview-url.mjs'
import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from './cms-url.mjs'

export const MAX_AGENT_ICON_BYTES = 10 * 1024
export const AGENT_ICON_FILENAME = 'agent-icon.png'
export const AGENT_ICON_SIZES = [64, 48, 32, 24]

const PRODUCTION_CMS_FALLBACK = CANONICAL_CMS_URL

function cmsPublicBase() {
  const fromEnv = (process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) return fromEnv
  return canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL_FALLBACK || PRODUCTION_CMS_FALLBACK)
}

/**
 * MCP connection details for Cursor/Hermes (Bearer), ChatGPT (OAuth) and Claude (OAuth).
 * @param {{ cmsUrl?: string }} [opts]
 */
export function getMcpConnectionInfo(opts = {}) {
  const provided = String(opts.cmsUrl || '').replace(/\/$/, '')
  const cmsUrl =
    provided && !/localhost|127\.0\.0\.1/i.test(provided) ? provided : cmsPublicBase()
  const mcpUrl = `${cmsUrl}/mcp/v3`
  return {
    mcpUrl,
    chatgpt: {
      url: mcpUrl,
      authMode: 'oauth',
      hint:
        'En ChatGPT ve a Conectores, crea uno con esta URL y elige OAuth. Autoriza con tu usuario o tu PAT personal.'
    },
    claude: {
      url: mcpUrl,
      authMode: 'oauth',
      hint:
        'En Claude ve a Customize > Connectors, añade esta URL y elige OAuth. Autoriza con tu usuario o tu PAT personal.'
    },
    cursorHermes: {
      url: mcpUrl,
      authMode: 'bearer',
      hint: 'En Cursor o Hermes usa Authorization Bearer con tu PAT personal.'
    }
  }
}

export function agentIconDiskPath(handle) {
  const h = String(handle || '').trim().toLowerCase()
  return join(mediaDir, h, AGENT_ICON_FILENAME)
}

export function agentIconPublicPath(handle) {
  const h = String(handle || '').trim().toLowerCase()
  return `/media/${h}/${AGENT_ICON_FILENAME}`
}

export function agentIconAbsoluteUrl(handle) {
  return absoluteMediaUrl(agentIconPublicPath(handle)) || `${cmsPublicBase()}${agentIconPublicPath(handle)}`
}

export function readSiteAgentIcon(handle) {
  const disk = agentIconDiskPath(handle)
  if (!existsSync(disk)) {
    return { ok: false, exists: false, bytes: 0, path: agentIconPublicPath(handle), url: agentIconAbsoluteUrl(handle) }
  }
  const bytes = statSync(disk).size
  return {
    ok: bytes > 0 && bytes <= MAX_AGENT_ICON_BYTES,
    exists: true,
    bytes,
    path: agentIconPublicPath(handle),
    url: agentIconAbsoluteUrl(handle),
    underLimit: bytes <= MAX_AGENT_ICON_BYTES
  }
}

function normalizeBaseUrl(siteUrl) {
  const raw = String(siteUrl || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    u.hash = ''
    u.search = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function resolveAgainst(base, href) {
  try {
    return new URL(href, base.endsWith('/') ? base : `${base}/`).toString()
  } catch {
    return ''
  }
}

/**
 * Parse HTML for favicon-like link tags. Pure helper for tests.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function extractFaviconCandidates(html, baseUrl) {
  const base = normalizeBaseUrl(baseUrl)
  if (!base) return []
  const text = String(html || '')
  const scored = []

  const linkRe = /<link\b[^>]*>/gi
  let match
  while ((match = linkRe.exec(text))) {
    const tag = match[0]
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || ''
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || ''
    if (!href || !rel) continue
    const relNorm = rel.toLowerCase()
    const isIcon =
      relNorm.includes('icon') ||
      relNorm.includes('apple-touch-icon') ||
      relNorm.includes('shortcut')
    if (!isIcon) continue
    const url = resolveAgainst(base, href)
    if (!url) continue
    let score = 10
    if (relNorm.includes('apple-touch-icon')) score = 40
    else if (relNorm === 'icon') score = 30
    else if (relNorm.includes('shortcut')) score = 25
    const sizes = (tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i) || [])[1] || ''
    const dim = Number((sizes.match(/(\d+)/) || [])[1] || 0)
    if (dim >= 64 && dim <= 256) score += 20
    else if (dim > 256) score += 5
    if (/\.png($|\?)/i.test(url)) score += 15
    else if (/\.ico($|\?)/i.test(url)) score += 8
    else if (/\.jpe?g($|\?)/i.test(url)) score += 6
    else if (/\.svg($|\?)/i.test(url)) score += 4
    scored.push({ url, score })
  }

  scored.sort((a, b) => b.score - a.score)
  const urls = scored.map((s) => s.url)
  const fallbacks = [`${base}/favicon.ico`, `${base}/favicon.png`, `${base}/apple-touch-icon.png`]
  for (const fb of fallbacks) {
    if (!urls.includes(fb)) urls.push(fb)
  }
  return [...new Set(urls)]
}

async function defaultFetch(url, init = {}) {
  const timeoutMs = Number(process.env.CMS_FAVICON_TIMEOUT_MS || 8000)
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    ...init,
    headers: {
      'User-Agent': 'EscarletBlogCMS/2 favicon-fetch',
      Accept: init.accept || '*/*',
      ...(init.headers || {})
    }
  })
}

/**
 * @param {string} siteUrl
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<string[]>}
 */
export async function discoverFaviconUrls(siteUrl, opts = {}) {
  const base = normalizeBaseUrl(siteUrl)
  if (!base) throw new Error('Falta la URL pública del sitio para buscar el favicon.')
  const fetchImpl = opts.fetchImpl || defaultFetch

  let html = ''
  try {
    const res = await fetchImpl(base, { accept: 'text/html,application/xhtml+xml' })
    if (res.ok) {
      const type = String(res.headers.get('content-type') || '')
      if (/html|xml|text/i.test(type) || !type) {
        html = await res.text()
      }
    }
  } catch {
    html = ''
  }

  const candidates = extractFaviconCandidates(html, base)
  const reachable = []
  for (const candidate of candidates) {
    try {
      const head = await fetchImpl(candidate, { method: 'HEAD' })
      if (head.ok || head.status === 405) reachable.push(candidate)
    } catch {
      // keep for GET download later
    }
  }
  const ordered = reachable.length ? [...reachable, ...candidates.filter((u) => !reachable.includes(u))] : candidates
  if (!ordered.length) throw new Error('No se encontró un favicon en la web del sitio.')
  return [...new Set(ordered)]
}

/**
 * @param {string} siteUrl
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function discoverFaviconUrl(siteUrl, opts = {}) {
  const urls = await discoverFaviconUrls(siteUrl, opts)
  return urls[0]
}

/**
 * Extract the largest embedded PNG (or BMP) payload from an ICO buffer.
 * @param {Buffer} buf
 * @returns {Buffer|null}
 */
export function extractImageFromIco(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 6) return null
  const reserved = buf.readUInt16LE(0)
  const type = buf.readUInt16LE(2)
  const count = buf.readUInt16LE(4)
  if (reserved !== 0 || (type !== 1 && type !== 2) || count < 1) return null

  let best = null
  let bestArea = -1
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16
    if (offset + 16 > buf.length) break
    const width = buf[offset] === 0 ? 256 : buf[offset]
    const height = buf[offset + 1] === 0 ? 256 : buf[offset + 1]
    const size = buf.readUInt32LE(offset + 8)
    const dataOffset = buf.readUInt32LE(offset + 12)
    if (dataOffset + size > buf.length || size < 8) continue
    const slice = buf.subarray(dataOffset, dataOffset + size)
    const area = width * height
    if (area >= bestArea) {
      bestArea = area
      best = Buffer.from(slice)
    }
  }
  return best
}

function looksLikeIco(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 6) return false
  return buf.readUInt16LE(0) === 0 && (buf.readUInt16LE(2) === 1 || buf.readUInt16LE(2) === 2)
}

function looksLikeSvg(buf) {
  const head = String(buf.subarray(0, Math.min(buf.length, 512)) || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
  return head.startsWith('<svg') || head.includes('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
}

/**
 * Rasterise SVG favicon to PNG via resvg (pure WASM/native, Alpine-friendly).
 * @param {Buffer} svgBuf
 * @param {{ size?: number }} [opts]
 * @returns {Buffer}
 */
export function rasteriseSvgToPng(svgBuf, opts = {}) {
  const size = Math.max(16, Math.min(256, Number(opts.size) || 128))
  let svgText = Buffer.isBuffer(svgBuf) ? svgBuf.toString('utf8') : String(svgBuf || '')
  svgText = svgText.replace(/^\uFEFF/, '').trim()
  if (!svgText) throw new Error('El SVG del favicon está vacío.')

  // Ensure xmlns so resvg accepts minimal marks
  if (!/\sxmlns=/i.test(svgText) && /<svg\b/i.test(svgText)) {
    svgText = svgText.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  try {
    const resvg = new Resvg(svgText, {
      fitTo: { mode: 'width', value: size },
      background: 'rgba(255,255,255,1)',
      font: { loadSystemFonts: false },
      logLevel: 'off'
    })
    const rendered = resvg.render()
    return Buffer.from(rendered.asPng())
  } catch (err) {
    throw new Error(`No se pudo convertir el favicon SVG a PNG (${err.message}).`)
  }
}

/**
 * Convert any common favicon buffer into a PNG under 10 KB.
 * Accepts PNG, JPEG, ICO and SVG.
 * @param {Buffer} input
 * @param {{ contentType?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function convertToAgentPng(input, opts = {}) {
  let buf = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
  if (!buf.length) throw new Error('El favicon descargado está vacío.')

  const type = String(opts.contentType || '').toLowerCase()
  if (looksLikeSvg(buf) || type.includes('svg')) {
    buf = rasteriseSvgToPng(buf, { size: 128 })
  } else if (looksLikeIco(buf) || type.includes('icon') || type.includes('x-icon')) {
    const extracted = extractImageFromIco(buf)
    if (!extracted) throw new Error('No se pudo leer el archivo ICO del favicon.')
    if (looksLikeSvg(extracted)) buf = rasteriseSvgToPng(extracted, { size: 128 })
    else buf = extracted
  }

  let image
  try {
    image = await Jimp.read(buf)
  } catch (err) {
    throw new Error(`No se pudo decodificar el favicon (${err.message}).`)
  }

  let best = null
  for (const size of AGENT_ICON_SIZES) {
    const frame = image.clone().cover(size, size)
    // Flatten alpha onto white for opaque GPT icons when mostly transparent
    if (frame.hasAlpha()) {
      const bg = new Jimp(size, size, 0xffffffff)
      bg.composite(frame, 0, 0)
      frame.bitmap = bg.bitmap
    }
    const png = await frame.quality(80).getBufferAsync(Jimp.MIME_PNG)
    if (!best || png.length < best.length) best = png
    if (png.length <= MAX_AGENT_ICON_BYTES) return png
  }

  if (best && best.length <= MAX_AGENT_ICON_BYTES) return best
  if (best) {
    // Last resort: 16×16
    const tiny = image.clone().cover(16, 16)
    const png = await tiny.getBufferAsync(Jimp.MIME_PNG)
    if (png.length <= MAX_AGENT_ICON_BYTES) return png
    throw new Error(
      `El icono sigue ocupando ${Math.ceil((best.length || png.length) / 1024)} KB. Hace falta menos de 10 KB.`
    )
  }
  throw new Error('No se pudo generar el PNG del icono.')
}

/**
 * @param {string} faviconUrl
 * @param {{ fetchImpl?: Function }} [opts]
 */
export async function downloadFavicon(faviconUrl, opts = {}) {
  const fetchImpl = opts.fetchImpl || defaultFetch
  const res = await fetchImpl(faviconUrl, { accept: 'image/*,*/*' })
  if (!res.ok) throw new Error(`No se pudo descargar el favicon (${res.status}).`)
  const ab = await res.arrayBuffer()
  const buffer = Buffer.from(ab)
  const contentType = res.headers?.get?.('content-type') || ''
  return { buffer, contentType, url: faviconUrl }
}

/**
 * Discover, download, convert and store agent icon for a site.
 * Fails soft via returned { ok:false } when opts.soft !== false (default soft).
 * @param {string} handle
 * @param {string} siteUrl
 * @param {{ fetchImpl?: Function, soft?: boolean, force?: boolean }} [opts]
 */
export async function prepareSiteAgentIcon(handle, siteUrl, opts = {}) {
  const soft = opts.soft !== false
  const h = String(handle || '').trim().toLowerCase()
  if (!h) {
    const err = { ok: false, message: 'Falta el handle del sitio.' }
    if (!soft) throw new Error(err.message)
    return err
  }

  const existing = readSiteAgentIcon(h)
  if (existing.ok && !opts.force) {
    return {
      ok: true,
      reused: true,
      message: 'Icono del agente listo.',
      ...existing
    }
  }

  try {
    const candidates = await discoverFaviconUrls(siteUrl, opts)
    let lastError = null
    for (const faviconUrl of candidates) {
      try {
        const downloaded = await downloadFavicon(faviconUrl, opts)
        const png = await convertToAgentPng(downloaded.buffer, {
          contentType: downloaded.contentType
        })
        const disk = agentIconDiskPath(h)
        mkdirSync(dirname(disk), { recursive: true })
        writeFileSync(disk, png)
        const info = readSiteAgentIcon(h)
        return {
          ok: true,
          reused: false,
          message: 'Icono PNG generado a partir del favicon del sitio.',
          sourceUrl: faviconUrl,
          ...info
        }
      } catch (err) {
        lastError = err
      }
    }
    throw lastError || new Error('No se pudo preparar el icono del agente.')
  } catch (err) {
    const result = {
      ok: false,
      message: err.message || 'No se pudo preparar el icono del agente.',
      path: agentIconPublicPath(h),
      url: agentIconAbsoluteUrl(h),
      exists: existing.exists,
      bytes: existing.bytes
    }
    if (!soft) throw err
    return result
  }
}

export function loadAgentIconBuffer(handle) {
  const disk = agentIconDiskPath(handle)
  if (!existsSync(disk)) return null
  return readFileSync(disk)
}
