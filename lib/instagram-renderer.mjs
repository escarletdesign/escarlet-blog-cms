import { Resvg } from '@resvg/resvg-js'
import { chooseSocialTemplate } from './visual-system.mjs'

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
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
  return lines.map((line, index) => `<text x="${x}" y="${y + index * fontSize * lineHeight}" font-family="Inter, Arial, sans-serif" font-size="${fontSize}px" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`).join('')
}

function backgroundHref(backgroundBase64, mime = 'image/png') {
  const value = String(backgroundBase64 || '').trim()
  if (!value) return ''
  return value.startsWith('data:') ? value : `data:${mime};base64,${value}`
}

export function buildSlideSvg({ slide = {}, templateId = 'editorial', backgroundBase64 = '', backgroundMime = 'image/png', site = 'escarlet' } = {}) {
  const template = chooseSocialTemplate({ site, preferredId: templateId }) || {}
  const width = template.canvas?.width || 1080
  const height = template.canvas?.height || 1350
  const dark = template.id === 'impact'
  const palette = dark ? { base: '#1E1E1E', text: '#FFFFFF', accent: '#E8B73A', wash: 'rgba(30,30,30,.76)' } : { base: '#F3E7D0', text: '#1E1E1E', accent: '#12B8D6', wash: 'rgba(243,231,208,.82)' }
  const headline = wrapText(slide.headline || '', template.headline?.maxChars || 60, template.headline?.maxLines || 3)
  const body = wrapText(slide.body || '', template.body?.maxChars || 160, template.body?.maxLines || 4)
  const bg = backgroundHref(backgroundBase64, backgroundMime)
  const background = bg ? `<image href="${bg}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${width}" height="${height}" fill="${palette.base}"/>`
  const overlay = `<rect width="${width}" height="${height}" fill="${palette.wash}"/>`
  const accent = dark
    ? `<rect x="${width - 180}" y="88" width="92" height="18" rx="9" fill="${palette.accent}"/>`
    : `<rect x="88" y="88" width="92" height="10" fill="${palette.accent}"/>`
  const headlineY = template.headline?.y || (dark ? 180 : 255)
  const bodyY = template.body?.y || (dark ? 860 : 770)
  const footerY = template.footer?.y || 1240
  const eyebrow = dark ? 'ESCARLET' : 'ESCARLET · IDEA EDITORIAL'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}${overlay}${accent}<text x="88" y="${dark ? 170 : 160}" font-family="Inter, Arial, sans-serif" font-size="${dark ? 20 : 18}px" font-weight="700" letter-spacing="3" fill="${palette.text}">${eyebrow}</text>${textBlock(headline, { x: template.headline?.x || 88, y: headlineY, fontSize: template.headline?.fontSize || (dark ? 86 : 70), lineHeight: template.headline?.lineHeight || 1.05, fill: palette.text, weight: template.font?.headlineWeight || 700 })}${textBlock(body, { x: template.body?.x || 88, y: bodyY, fontSize: template.body?.fontSize || 32, lineHeight: template.body?.lineHeight || 1.2, fill: dark ? '#FFFFFF' : '#6D6D6D', weight: template.font?.bodyWeight || 400 })}<text x="88" y="${footerY}" font-family="Inter, Arial, sans-serif" font-size="${template.footer?.fontSize || 18}px" font-weight="600" letter-spacing="2" fill="${palette.text}">${escapeXml(template.footer?.text || 'escarlet.design')}</text></svg>`
}

export function renderSlidePng(options = {}) {
  const svg = buildSlideSvg(options)
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng())
}

export function renderCarouselSlides({ slides = [], backgrounds = [], templateId = 'editorial', site = 'escarlet' } = {}) {
  return slides.map((slide, index) => ({
    ...slide,
    templateId,
    renderedBy: 'content-system/instagram-renderer',
    png: renderSlidePng({ slide, templateId, site, backgroundBase64: backgrounds[index]?.base64 || backgrounds[index] || '' })
  }))
}

export { wrapText }
