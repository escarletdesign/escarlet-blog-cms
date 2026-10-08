import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const MIME_BY_EXTENSION = Object.freeze({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' })

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}

function dimensionsFor(formatProfile = '') {
  const profile = String(formatProfile || '').toLowerCase()
  if (profile.includes('story')) return { width: 1080, height: 1920 }
  if (profile.includes('linkedin')) return { width: 1200, height: 627 }
  if (profile.includes('blog') || profile.includes('cover')) return { width: 1600, height: 900 }
  return { width: 1080, height: 1350 }
}

export function buildProductTransformSvg({ imageBase64, imageMime = 'image/jpeg', site = 'brand', title = '', width, height, palette = {} } = {}) {
  const href = imageBase64 ? `data:${imageMime};base64,${imageBase64}` : ''
  const panelHeight = Math.max(230, Math.round(height * 0.2))
  const titleText = String(title || '').trim().slice(0, 100)
  const background = /^#[0-9a-f]{6}$/i.test(String(palette.cream || '')) ? palette.cream : '#F4F7F2'
  const foreground = /^#[0-9a-f]{6}$/i.test(String(palette.charcoal || '')) ? palette.charcoal : '#1E1E1E'
  const accentValue = palette.gold || palette.primary || ''
  const accent = /^#[0-9a-f]{6}$/i.test(String(accentValue)) ? accentValue : '#E8B73A'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${background}"/>${href ? `<image href="${href}" x="44" y="44" width="${width - 88}" height="${height - panelHeight - 88}" preserveAspectRatio="xMidYMid meet"/>` : ''}<rect x="0" y="${height - panelHeight}" width="${width}" height="${panelHeight}" fill="${foreground}"/><rect x="54" y="${height - panelHeight + 52}" width="110" height="12" rx="6" fill="${accent}"/><text x="54" y="${height - panelHeight + 112}" font-family="Arial, sans-serif" font-size="22px" font-weight="700" letter-spacing="4" fill="#FFFFFF">${escapeXml(String(site || 'brand').toUpperCase())}</text>${titleText ? `<text x="54" y="${height - 58}" font-family="Arial, sans-serif" font-size="34px" font-weight="700" fill="#FFFFFF">${escapeXml(titleText)}</text>` : ''}</svg>`
}

export function renderProductTransform({ sourcePath, site = 'brand', title = '', formatProfile = '' } = {}) {
  if (!sourcePath || !existsSync(sourcePath)) throw Object.assign(new Error('El asset fuente no está disponible en el almacenamiento local.'), { code: 'product_source_unavailable', status: 409 })
  const source = readFileSync(sourcePath)
  const { width, height } = dimensionsFor(formatProfile)
  const svg = buildProductTransformSvg({ imageBase64: source.toString('base64'), imageMime: MIME_BY_EXTENSION[extname(sourcePath).toLowerCase()] || 'image/jpeg', site, title, width, height })
  return Buffer.from(new Resvg(svg).render().asPng())
}
