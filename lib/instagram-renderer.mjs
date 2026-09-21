import { Resvg } from '@resvg/resvg-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseSocialTemplate } from './visual-system.mjs'

const officialLogoPath = join(fileURLToPath(new URL('..', import.meta.url)), 'payload', 'escarlet-brandkit', 'assets', 'logo-official-white.svg')
const officialLogoDataUri = existsSync(officialLogoPath)
  ? `data:image/svg+xml;base64,${readFileSync(officialLogoPath).toString('base64')}`
  : ''

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
}

function normalizeSlideText(value) {
  return String(value || '')
    .replace(/(^|\s)(?:-{1,3}|[\u2014\u2013\u2015\uFE58\uFE63\uFF0D])(?=\s|$)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function wrapText(value, maxChars, maxLines) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else current = next
  }
  if (current) lines.push(current)
  if (lines.length <= maxLines) return lines
  const clipped = lines.slice(0, maxLines)
  clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/[.,;:!?-]+$/, '')}…`
  return clipped
}

function textBlock(lines, { x, y, fontSize, lineHeight, fill, weight }) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * fontSize * lineHeight}" font-family="Montserrat, Arial, sans-serif" font-size="${fontSize}px" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`).join('')
}

function backgroundHref(backgroundBase64, mime = 'image/png') {
  const value = String(backgroundBase64 || '').trim()
  if (!value) return ''
  return value.startsWith('data:') ? value : `data:${mime};base64,${value}`
}

export function buildSlideSvg({ slide = {}, templateId = 'editorial', backgroundBase64 = '', backgroundMime = 'image/png', site = 'escarlet', slideIndex = 0, slideCount = 1 } = {}) {
  const template = chooseSocialTemplate({ site, preferredId: templateId }) || {}
  const width = template.canvas?.width || 1080
  const height = template.canvas?.height || 1350
  const position = slide.position || (slideIndex === 0 ? 'first' : slideIndex === slideCount - 1 ? 'last' : 'middle')
  const edge = position === 'first' || position === 'last'
  const dark = !edge && template.id === 'impact'
  const palette = edge
    ? { base: '#47A4E7', text: '#FFFFFF', body: '#FFFFFF', accent: '#E8B73A', wash: '' }
    : dark
      ? { base: '#1E1E1E', text: '#FFFFFF', body: '#FFFFFF', accent: '#E8B73A', wash: 'rgba(30,30,30,.76)' }
      : { base: '#FFFFFF', text: '#1E1E1E', body: '#1E1E1E', accent: '#12B8D6', wash: 'rgba(255,255,255,.88)' }
  const headline = wrapText(normalizeSlideText(slide.headline), Math.min(template.headline?.maxChars || 60, 24), Math.min(3, template.headline?.maxLines || 3))
  const body = wrapText(normalizeSlideText(slide.body), Math.min(template.body?.maxChars || 160, 52), Math.min(3, template.body?.maxLines || 3))
  const bg = backgroundHref(backgroundBase64, backgroundMime)
  const background = bg ? `<image href="${bg}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${width}" height="${height}" fill="${palette.base}"/>`
  const overlay = palette.wash ? `<rect width="${width}" height="${height}" fill="${palette.wash}"/>` : ''
  const accent = edge
    ? `<rect x="88" y="88" width="118" height="16" rx="8" fill="${palette.accent}"/>`
    : dark
      ? `<rect x="${width - 180}" y="88" width="92" height="18" rx="9" fill="${palette.accent}"/>`
      : `<rect x="88" y="88" width="92" height="10" fill="${palette.accent}"/>`
  const headlineY = template.headline?.y || (dark ? 180 : 255)
  const bodyY = template.body?.y || (dark ? 860 : 770)
  const footerY = template.footer?.y || 1240
  const logo = edge && officialLogoDataUri
    ? `<image href="${officialLogoDataUri}" x="${width - 388}" y="${height - 168}" width="300" height="70" preserveAspectRatio="xMidYMid meet"/>`
    : ''
  const eyebrow = edge ? '' : dark ? 'ESCARLET' : 'ESCARLET · IDEA EDITORIAL'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}${overlay}${accent}${eyebrow ? `<text x="88" y="${dark ? 170 : 160}" font-family="Montserrat, Arial, sans-serif" font-size="${dark ? 20 : 18}px" font-weight="700" letter-spacing="3" fill="${palette.text}">${eyebrow}</text>` : ''}${textBlock(headline, { x: template.headline?.x || 88, y: headlineY, fontSize: Math.max(88, template.headline?.fontSize || (dark ? 96 : 88)), lineHeight: template.headline?.lineHeight || 1.05, fill: palette.text, weight: template.font?.headlineWeight || 700 })}${textBlock(body, { x: template.body?.x || 88, y: bodyY, fontSize: Math.max(36, template.body?.fontSize || 36), lineHeight: template.body?.lineHeight || 1.2, fill: palette.body, weight: template.font?.bodyWeight || 400 })}${edge ? logo : `<text x="88" y="${footerY}" font-family="Montserrat, Arial, sans-serif" font-size="${template.footer?.fontSize || 18}px" font-weight="600" letter-spacing="2" fill="${palette.text}">${escapeXml(template.footer?.text || 'escarlet.design')}</text>`}</svg>`
}

export function renderSlidePng(options = {}) {
  const svg = buildSlideSvg(options)
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng())
}

export function renderCarouselSlides({ slides = [], backgrounds = [], templateId = 'editorial', site = 'escarlet' } = {}) {
  return slides.map((slide, index) => ({
    ...slide,
    position: index === 0 ? 'first' : index === slides.length - 1 ? 'last' : 'middle',
    slideIndex: index,
    slideCount: slides.length,
    templateId,
    renderedBy: 'content-system/instagram-renderer',
    png: renderSlidePng({ slide: { ...slide, position: index === 0 ? 'first' : index === slides.length - 1 ? 'last' : 'middle' }, templateId, site, slideIndex: index, slideCount: slides.length, backgroundBase64: backgrounds[index]?.base64 || backgrounds[index] || '' })
  }))
}

export { wrapText }
