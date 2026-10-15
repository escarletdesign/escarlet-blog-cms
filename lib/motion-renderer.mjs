import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import Jimp from 'jimp'
import { assertProcessableImageBuffer } from './media-url.mjs'

const MIME_BY_EXTENSION = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
})

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}

function normalizeMotionCopy(value) {
  return String(value ?? '').replace(/[\u2014\u2013]/g, '-')
}

function wrapText(value, maxChars, maxLines) {
  const words = normalizeMotionCopy(value).trim().split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > maxChars && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const clipped = lines.slice(0, maxLines)
  clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/[.,;:!?]+$/, '')}…`
  return clipped
}

function textBlock(lines, { x, y, size, lineHeight, weight, fill, stroke = '', strokeOpacity = 0 }) {
  const outline = stroke ? ` stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="2" paint-order="stroke"` : ''
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-family="Arial, sans-serif" font-size="${size}px" font-weight="${weight}" fill="${fill}"${outline}>${escapeXml(line)}</text>`).join('')
}

function motionTextLayout(position = 'bottom_left', width = 1080, height = 1920) {
  if (width > height) {
    const layouts = {
      top_left: { x: 120, accentY: 120, labelY: 190, titleY: 300, bodyY: 520 },
      center_left: { x: 120, accentY: 380, labelY: 450, titleY: 560, bodyY: 760 },
      bottom_left: { x: 120, accentY: height - 390, labelY: height - 320, titleY: height - 220, bodyY: height - 72 }
    }
    return layouts[position] || layouts.bottom_left
  }
  const layouts = {
    top_left: { x: 88, accentY: 160, labelY: 220, titleY: 330, bodyY: 620 },
    center_left: { x: 88, accentY: 760, labelY: 820, titleY: 930, bodyY: 1210 },
    bottom_left: { x: 88, accentY: height - 690, labelY: height - 620, titleY: height - 520, bodyY: height - 300 }
  }
  return layouts[position] || layouts.bottom_left
}

export function buildMotionSvg({ imageBase64, imageMime = 'image/jpeg', logoBase64 = '', logoMime = 'image/svg+xml', site = 'escarlet', title = '', text = '', width = 1080, height = 1920 } = {}) {
  const image = String(imageBase64 || '').trim()
  const href = image ? `data:${imageMime};base64,${image}` : ''
  const logo = String(logoBase64 || '').trim()
  const logoHref = logo ? `data:${logoMime};base64,${logo}` : ''
  const titleLines = wrapText(title || 'Reel de marca', 22, 2)
  const bodyLines = wrapText(text, 42, 4)
  const imageMarkup = href
    ? `<image href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${width}" height="${height}" fill="#1E1E1E"/>`
  const logoMarkup = logoHref ? `<image href="${logoHref}" x="${width - 388}" y="${height - 168}" width="300" height="70" preserveAspectRatio="xMidYMid meet"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${imageMarkup}<rect width="${width}" height="${height}" fill="rgba(0,0,0,.14)"/><rect x="0" y="${height - 780}" width="${width}" height="780" fill="rgba(0,0,0,.72)"/><rect x="88" y="${height - 690}" width="132" height="16" rx="8" fill="#E8B73A"/><text x="88" y="${height - 620}" font-family="Arial, sans-serif" font-size="22px" font-weight="700" letter-spacing="4" fill="#FFFFFF">${escapeXml(String(site || 'brand').toUpperCase())}</text>${textBlock(titleLines, { x: 88, y: height - 520, size: 82, lineHeight: 88, weight: 700, fill: '#FFFFFF' })}${textBlock(bodyLines, { x: 88, y: height - 300, size: 38, lineHeight: 48, weight: 400, fill: '#FFFFFF' })}${logoMarkup}</svg>`
}

const MOTION_RENDER_MODES = new Set(['flat_slides', 'layered_motion'])
const MOTION_FITS = new Set(['contain', 'cover'])
const MOTION_BACKGROUND_MODES = new Set(['blurred_source', 'brand_color', 'generated'])
const MOTION_PRESETS = new Set(['none', 'subtle_editorial', 'dynamic_editorial'])
const MOTION_TEXT_ANIMATIONS = new Set(['none', 'fade_in', 'fade_up', 'slide_left', 'slide_right'])
const MOTION_TEXT_POSITIONS = new Set(['top_left', 'center_left', 'bottom_left'])
const MOTION_TEXT_TONES = new Set(['auto', 'light', 'dark'])
const MOTION_TRANSITIONS = new Set(['none', 'crossfade', 'fade', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'fadeblack', 'fadewhite'])
const MOTION_LAYER_TYPES = new Set(['image', 'text', 'logo', 'shape'])
const MOTION_LAYER_ANIMATIONS = new Set(['none', 'fade', 'fade_up', 'slide_left', 'slide_right', 'drift', 'pop'])

export const MOTION_FORMAT_PROFILES = Object.freeze({
  instagram_reel: Object.freeze({ width: 1080, height: 1920, safeArea: { x: 88, y: 120, width: 904, height: 1680 } }),
  instagram_story: Object.freeze({ width: 1080, height: 1920, safeArea: { x: 88, y: 120, width: 904, height: 1680 } }),
  youtube_landscape: Object.freeze({ width: 1920, height: 1080, safeArea: { x: 120, y: 72, width: 1680, height: 936 } }),
  youtube: Object.freeze({ width: 1920, height: 1080, safeArea: { x: 120, y: 72, width: 1680, height: 936 } }),
  landscape: Object.freeze({ width: 1920, height: 1080, safeArea: { x: 120, y: 72, width: 1680, height: 936 } })
})

export function normalizeMotionFormat(formatProfile = '', width = 0, height = 0) {
  const requested = String(formatProfile || '').trim().toLowerCase()
  const profile = MOTION_FORMAT_PROFILES[requested] || (requested.includes('youtube') || requested.includes('landscape') ? MOTION_FORMAT_PROFILES.youtube_landscape : MOTION_FORMAT_PROFILES.instagram_reel)
  const resolvedWidth = Number.isFinite(Number(width)) && Number(width) >= 320 ? Math.min(3840, Math.round(Number(width))) : profile.width
  const resolvedHeight = Number.isFinite(Number(height)) && Number(height) >= 180 ? Math.min(3840, Math.round(Number(height))) : profile.height
  const scaleX = resolvedWidth / profile.width
  const scaleY = resolvedHeight / profile.height
  return {
    formatProfile: requested || (resolvedWidth > resolvedHeight ? 'youtube_landscape' : 'instagram_reel'),
    width: resolvedWidth,
    height: resolvedHeight,
    safeArea: {
      x: Math.round(profile.safeArea.x * scaleX),
      y: Math.round(profile.safeArea.y * scaleY),
      width: Math.round(profile.safeArea.width * scaleX),
      height: Math.round(profile.safeArea.height * scaleY)
    }
  }
}

function normalizeMotionTextAnimation(value, fallback = 'none') {
  const normalized = String(value || '').trim().toLowerCase()
  return MOTION_TEXT_ANIMATIONS.has(normalized) ? normalized : fallback
}

function normalizeMotionTextPosition(value, fallback = 'bottom_left') {
  const normalized = String(value || '').trim().toLowerCase()
  return MOTION_TEXT_POSITIONS.has(normalized) ? normalized : fallback
}

function normalizeMotionTextTone(value, fallback = 'auto') {
  const normalized = String(value || '').trim().toLowerCase()
  return MOTION_TEXT_TONES.has(normalized) ? normalized : fallback
}

function normalizeMotionTransition(value = {}) {
  const requestedType = String(value?.type || 'crossfade').trim().toLowerCase()
  const type = requestedType === 'crossfade' ? 'crossfade' : MOTION_TRANSITIONS.has(requestedType) ? requestedType : 'crossfade'
  const durationMs = Number(value?.durationMs)
  return {
    type,
    durationMs: type === 'none' ? 0 : Number.isFinite(durationMs) && durationMs >= 0 ? Math.min(1000, Math.round(durationMs)) : 400
  }
}

function normalizeDurationMs(value, fallback = 4000) {
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? Math.min(120000, Math.round(duration)) : fallback
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

export function normalizeMotionLayers(layers = [], { width = 1080, height = 1920, safeArea } = {}) {
  const area = safeArea || normalizeMotionFormat('', width, height).safeArea
  if (!Array.isArray(layers)) return []
  return layers.slice(0, 32).map((layer, index) => {
    const value = layer && typeof layer === 'object' ? layer : {}
    const requestedType = String(value.type || value.role || 'image').trim().toLowerCase()
    const type = MOTION_LAYER_TYPES.has(requestedType)
      ? requestedType
      : ['headline', 'body', 'caption'].includes(requestedType)
        ? 'text'
        : requestedType === 'icon'
          ? 'image'
          : 'image'
    const animation = MOTION_LAYER_ANIMATIONS.has(String(value.animation || 'none').trim().toLowerCase()) ? String(value.animation || 'none').trim().toLowerCase() : 'none'
    const defaultWidth = type === 'text' ? Math.round(area.width * 0.78) : type === 'shape' ? 240 : Math.round(area.width * 0.42)
    const defaultHeight = type === 'text' ? 120 : type === 'shape' ? 120 : Math.round(area.height * 0.28)
    const layerWidth = Math.round(boundedNumber(value.width ?? value.w, defaultWidth, 1, width))
    const layerHeight = Math.round(boundedNumber(value.height ?? value.h, defaultHeight, 1, height))
    const x = Math.round(boundedNumber(value.x, area.x, 0, Math.max(0, width - layerWidth)))
    const y = Math.round(boundedNumber(value.y, area.y, 0, Math.max(0, height - layerHeight)))
    const startMs = Math.round(boundedNumber(value.startMs, 0, 0, 120000))
    const endMs = Math.round(boundedNumber(value.endMs, 120000, startMs + 1, 120000))
    const normalized = {
      layerId: String(value.layerId || value.id || `${type}-${index + 1}`).trim().slice(0, 120),
      type,
      role: String(value.role || type).trim().slice(0, 40),
      path: String(value.path || value.sourcePath || '').trim(),
      text: normalizeMotionCopy(String(value.text || value.value || '').trim()).slice(0, 2000),
      x,
      y,
      width: layerWidth,
      height: layerHeight,
      opacity: boundedNumber(value.opacity, 1, 0, 1),
      startMs,
      endMs,
      animation,
      color: String(value.color || '#E8B73A').trim().slice(0, 32),
      fontSize: Math.round(boundedNumber(value.fontSize, width > height ? 64 : 54, 8, 240)),
      fontWeight: Math.round(boundedNumber(value.fontWeight, 700, 100, 900)),
      align: ['left', 'center', 'right'].includes(String(value.align || 'left')) ? String(value.align || 'left') : 'left'
    }
    if (Array.isArray(value.keyframes) && value.keyframes.length) {
      normalized.keyframes = value.keyframes.slice(0, 4).map((frame) => ({
        atMs: Math.round(boundedNumber(frame?.atMs, 0, 0, 120000)),
        x: Math.round(boundedNumber(frame?.x, x, 0, Math.max(0, width - layerWidth))),
        y: Math.round(boundedNumber(frame?.y, y, 0, Math.max(0, height - layerHeight))),
        opacity: boundedNumber(frame?.opacity, normalized.opacity, 0, 1)
      })).sort((left, right) => left.atMs - right.atMs)
    }
    return normalized
  })
}

export function normalizeMotionScenes({ scenes = [], sourcePath = '', title = '', text = '', durationSeconds = 8, renderMode = 'layered_motion', backgroundMode = 'blurred_source', motionPreset = 'subtle_editorial', transition = {}, formatProfile = '', width = 0, height = 0 } = {}) {
  const format = normalizeMotionFormat(formatProfile, width, height)
  const mode = MOTION_RENDER_MODES.has(String(renderMode)) ? String(renderMode) : 'layered_motion'
  const normalizedBackgroundMode = MOTION_BACKGROUND_MODES.has(String(backgroundMode)) ? String(backgroundMode) : 'blurred_source'
  const normalizedMotionPreset = MOTION_PRESETS.has(String(motionPreset)) ? String(motionPreset) : 'subtle_editorial'
  const normalizedTransition = normalizeMotionTransition(transition)
  const declared = Array.isArray(scenes) && scenes.length
    ? scenes
    : [{ path: sourcePath, title, body: text, durationMs: Math.max(3000, Math.round((Number(durationSeconds) || 8) * 1000)) }]
  const normalized = declared.map((scene, index) => {
    const value = scene && typeof scene === 'object' ? scene : {}
    const path = String(value.path || value.sourcePath || '').trim()
    if (!path) throw Object.assign(new Error(`La escena ${index + 1} no tiene un asset resoluble.`), { code: 'motion_scene_asset_missing', status: 409 })
    const fit = MOTION_FITS.has(String(value.fit || 'contain')) ? String(value.fit || 'contain') : 'contain'
    const requestedPreset = String(value.motionPreset || '').trim().toLowerCase()
    const scenePreset = MOTION_PRESETS.has(requestedPreset) ? requestedPreset : normalizedMotionPreset
    const defaultPosition = scenePreset === 'dynamic_editorial' ? ['top_left', 'center_left', 'bottom_left'][index % 3] : 'bottom_left'
    return {
      path,
      fit,
      durationMs: normalizeDurationMs(value.durationMs),
      title: String(value.title || value.headline || '').trim().slice(0, 160),
      body: String(value.body || value.text || '').trim().slice(0, 1000),
      sceneId: String(value.sceneId || `scene-${index + 1}`).trim().slice(0, 120),
      backgroundPath: String(value.backgroundPath || '').trim(),
      motionPreset: scenePreset,
      textAnimation: normalizeMotionTextAnimation(value.textAnimation, scenePreset === 'dynamic_editorial' ? 'fade_up' : 'none'),
      textPosition: normalizeMotionTextPosition(value.textPosition, defaultPosition),
      textTone: normalizeMotionTextTone(value.textTone),
      layers: normalizeMotionLayers(value.layers, format)
    }
  })
  const totalMs = normalized.reduce((sum, scene) => sum + scene.durationMs, 0)
  if (!normalized.length || totalMs < 1000) throw Object.assign(new Error('El timeline de motion debe contener al menos una escena válida.'), { code: 'motion_timeline_invalid', status: 422 })
  return { ...format, renderMode: mode, scenes: normalized, totalMs, backgroundMode: normalizedBackgroundMode, motionPreset: normalizedMotionPreset, transition: normalizedTransition }
}

export function buildMotionSceneSvg({ imageBase64, imageMime = 'image/jpeg', backgroundBase64 = '', backgroundMime = 'image/jpeg', logoBase64 = '', logoMime = 'image/svg+xml', site = 'escarlet', title = '', text = '', width = 1080, height = 1920, fit = 'contain', renderMode = 'layered_motion', backgroundMode = 'blurred_source', backgroundColor = '#2A9D8F', includeText = true, textPosition = 'bottom_left', textTone = 'auto' } = {}) {
  const image = String(imageBase64 || '').trim()
  const href = image ? `data:${imageMime};base64,${image}` : ''
  const background = String(backgroundBase64 || '').trim()
  const backgroundHref = background ? `data:${backgroundMime};base64,${background}` : ''
  const logo = String(logoBase64 || '').trim()
  const logoHref = logo ? `data:${logoMime};base64,${logo}` : ''
  const preserveAspectRatio = fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
  const backgroundMarkup = fit === 'contain' && backgroundHref && backgroundMode !== 'brand_color'
    ? `<image href="${backgroundHref}" x="-${Math.round(width * 0.06)}" y="-${Math.round(height * 0.06)}" width="${Math.round(width * 1.12)}" height="${Math.round(height * 1.12)}" preserveAspectRatio="xMidYMid slice" opacity="0.92"${backgroundMode === 'blurred_source' ? ' filter="url(#motionBlur)"' : ''}/>`
    : `<rect width="${width}" height="${height}" fill="${escapeXml(backgroundColor)}"/>`
  const imageMarkup = href
    ? `${backgroundMarkup}<image href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${preserveAspectRatio}"/>`
    : backgroundMarkup
  if (renderMode === 'flat_slides') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="motionBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter></defs>${imageMarkup}</svg>`
  }
  const layout = motionTextLayout(normalizeMotionTextPosition(textPosition), width, height)
  const resolvedTone = normalizeMotionTextTone(textTone) === 'dark' ? 'dark' : 'light'
  const textColor = resolvedTone === 'dark' ? '#1B1B1B' : '#FFFFFF'
  const textStroke = resolvedTone === 'dark' ? '#FFFFFF' : '#000000'
  const titleLines = wrapText(title || 'Reel de marca', 22, 2)
  const bodyLines = wrapText(text, 42, 4)
  const logoMarkup = logoHref ? `<image href="${logoHref}" x="${width - 388}" y="${height - 168}" width="300" height="70" preserveAspectRatio="xMidYMid meet"/>` : ''
  const textMarkup = includeText
    ? `<rect x="${layout.x}" y="${layout.accentY}" width="132" height="16" rx="8" fill="#E8B73A"/><text x="${layout.x}" y="${layout.labelY}" font-family="Arial, sans-serif" font-size="22px" font-weight="700" letter-spacing="4" fill="${textColor}" stroke="${textStroke}" stroke-opacity=".2" stroke-width="1" paint-order="stroke">${escapeXml(normalizeMotionCopy(String(site || 'brand').toUpperCase()))}</text>${textBlock(titleLines, { x: layout.x, y: layout.titleY, size: 82, lineHeight: 88, weight: 700, fill: textColor, stroke: textStroke, strokeOpacity: .2 })}${textBlock(bodyLines, { x: layout.x, y: layout.bodyY, size: 38, lineHeight: 48, weight: 400, fill: textColor, stroke: textStroke, strokeOpacity: .2 })}`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="motionBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter><linearGradient id="motionShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${resolvedTone === 'dark' ? '0.08' : '0.38'}"/></linearGradient></defs>${imageMarkup}<rect width="${width}" height="${height}" fill="url(#motionShade)"/>${textMarkup}${logoMarkup}</svg>`
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve()
      reject(Object.assign(new Error(stderr.trim() || `FFmpeg terminó con código ${code}.`), { code: 'local_renderer_failed', status: 502 }))
    })
  })
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `El proceso terminó con código ${code}.`)))
  })
}

async function validateTransitionSamples({ ffmpegPath, outputPath, sceneFiles, transitionSeconds, workDir }) {
  if (sceneFiles.length < 2 || transitionSeconds <= 0) return []
  const samples = []
  let boundary = sceneFiles[0].durationMs / 1000
  for (let index = 1; index < sceneFiles.length; index += 1) {
    for (const offset of [-0.2, 0, 0.2]) {
      const timestamp = Math.max(0, boundary + offset)
      const samplePath = join(workDir, `qa-transition-${index}-${offset < 0 ? 'before' : offset > 0 ? 'after' : 'during'}.png`)
      try {
        await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', timestamp.toFixed(3), '-i', outputPath, '-frames:v', '1', '-f', 'image2', samplePath])
      } catch (error) {
        throw Object.assign(new Error(`La muestra de transición ${index} no se pudo decodificar: ${error.message}`), { code: 'motion_qa_failed', status: 422, cause: error })
      }
      if (!existsSync(samplePath) || statSync(samplePath).size < 100) throw Object.assign(new Error(`La muestra de transición ${index} está vacía.`), { code: 'motion_qa_failed', status: 422 })
      samples.push({ index, offset, timestamp })
    }
    boundary += sceneFiles[index].durationMs / 1000 - transitionSeconds
  }
  return samples
}

function mediaMime(path, fallback = 'image/jpeg') {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] || fallback
}

function motionFontFile() {
  const candidates = [
    process.env.MOTION_FONT_FILE,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf'
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) || ''
}

function escapeFilterValue(value) {
  return String(value || '').replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")
}

function motionTextOverlay({ scene, index, workDir, site, width = 1080, height = 1920 } = {}) {
  const animation = normalizeMotionTextAnimation(scene.textAnimation)
  if (animation === 'none' || (!scene.title && !scene.body)) return ''
  const layout = motionTextLayout(normalizeMotionTextPosition(scene.textPosition), width, height)
  const tone = normalizeMotionTextTone(scene.textTone) === 'dark' ? 'dark' : 'light'
  const textColor = tone === 'dark' ? '0x1B1B1B' : 'white'
  const shadowColor = tone === 'dark' ? 'white@0.5' : 'black@0.7'
  const blocks = [
    { name: 'label', value: normalizeMotionCopy(String(site || 'brand').toUpperCase()), x: layout.x, y: layout.labelY, size: 22, maxChars: 32, maxLines: 1, delay: 0 },
    { name: 'headline', value: normalizeMotionCopy(scene.title || 'Reel de marca'), x: layout.x, y: layout.titleY, size: 82, lineSpacing: 8, maxChars: 22, maxLines: 2, delay: 0.06 },
    { name: 'body', value: normalizeMotionCopy(scene.body || ''), x: layout.x, y: layout.bodyY, size: 38, lineSpacing: 8, maxChars: 42, maxLines: 4, delay: 0.14 }
  ].filter((entry) => entry.name === 'label' || entry.value)
  const files = blocks.flatMap((entry) => wrapText(entry.value, entry.maxChars, entry.maxLines).map((value, lineIndex) => ({
    ...entry,
    name: `${entry.name}-${lineIndex + 1}`,
    value,
    y: entry.y + lineIndex * (entry.size >= 80 ? 88 : 48)
  })))
  const fontFile = motionFontFile()
  const accentProgress = 'min(t/0.65,1)'
  const draw = files.map((entry) => {
    const path = join(workDir, `scene-${String(index + 1).padStart(3, '0')}-${entry.name}.txt`)
    writeFileSync(path, entry.value)
    const progress = `min(max((t-${entry.delay})/0.65,0),1)`
    const alpha = animation === 'none' ? '1' : `if(lt(t,${entry.delay}),0,${progress})`
    const x = animation === 'slide_left' ? `${entry.x}-90*(1-${progress})` : animation === 'slide_right' ? `${entry.x}+90*(1-${progress})` : String(entry.x)
    const y = entry.name.startsWith('headline') || entry.name.startsWith('body')
      ? animation === 'fade_up' ? `${entry.y}+45*(1-${progress})` : String(entry.y)
      : String(entry.y)
    const options = [
      fontFile ? `fontfile='${escapeFilterValue(fontFile)}'` : "font='Arial'",
      `textfile='${escapeFilterValue(path)}'`,
      `fontcolor=${textColor}`,
      `shadowcolor=${shadowColor}`,
      'shadowx=2',
      'shadowy=2',
      `fontsize=${entry.size}`,
      `x='${x}'`,
      `y='${y}'`,
      `alpha='${alpha}'`
    ]
    if (entry.lineSpacing) options.push(`line_spacing=${entry.lineSpacing}`)
    return `drawtext=${options.join(':')}`
  })
  return [`drawbox=x=${layout.x}:y=${layout.accentY}:w='132*${accentProgress}':h=16:color=0xE8B73A:t=fill`, ...draw].join(',')
}

function layerProgressExpression(layer, durationSeconds) {
  const start = (layer.startMs / 1000).toFixed(3)
  const available = Math.max(0.25, Math.min((layer.endMs - layer.startMs) / 1000, durationSeconds))
  return `min(max((t-${start})/${available.toFixed(3)},0),1)`
}

function layerMotionExpressions(layer, durationSeconds) {
  const progress = layerProgressExpression(layer, durationSeconds)
  const from = layer.keyframes?.[0]
  const to = layer.keyframes?.at(-1)
  const xStart = from?.x ?? layer.x
  const yStart = from?.y ?? layer.y
  const xEnd = to?.x ?? layer.x
  const yEnd = to?.y ?? layer.y
  const alphaStart = from?.opacity ?? 0
  const alphaEnd = to?.opacity ?? layer.opacity
  let x = `${layer.x}`
  let y = `${layer.y}`
  if (layer.keyframes?.length > 1) {
    x = `${xStart}+(${xEnd}-${xStart})*${progress}`
    y = `${yStart}+(${yEnd}-${yStart})*${progress}`
  } else if (layer.animation === 'fade_up') {
    y = `${layer.y}+40*(1-${progress})`
  } else if (layer.animation === 'slide_left') {
    x = `${layer.x}-80*(1-${progress})`
  } else if (layer.animation === 'slide_right') {
    x = `${layer.x}+80*(1-${progress})`
  } else if (layer.animation === 'drift') {
    x = `${layer.x}+8*sin(t*2)`
    y = `${layer.y}+4*cos(t*1.5)`
  }
  const alpha = layer.animation === 'none' ? String(layer.opacity) : `${alphaStart}+(${alphaEnd}-${alphaStart})*${progress}`
  return { x, y, alpha, progress }
}

function layerColor(value) {
  const color = String(value || '#E8B73A').trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? `0x${color.slice(1)}` : '0xE8B73A'
}

function layerInputFilter({ layer, inputIndex, durationSeconds }) {
  const scale = `scale=${layer.width}:${layer.height}:force_original_aspect_ratio=decrease,pad=${layer.width}:${layer.height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba`
  return `[${inputIndex}:v]fps=30,${scale},settb=AVTB,setpts=PTS-STARTPTS[layer-${layer.layerId}]`
}

function layerOverlayFilter({ current, layer, inputLabel, durationSeconds }) {
  const motion = layerMotionExpressions(layer, durationSeconds)
  const start = (layer.startMs / 1000).toFixed(3)
  const end = Math.min(durationSeconds, layer.endMs / 1000).toFixed(3)
  return `${current}[${inputLabel}]overlay=x='${motion.x}':y='${motion.y}':eof_action=repeat:shortest=0:format=auto:enable='between(t,${start},${end})'[${layer.layerId}-out]`
}

function materializeMotionLayer(layer, workDir, index) {
  if (!layer.path || !existsSync(layer.path)) return null
  if (extname(layer.path).toLowerCase() !== '.svg') return layer.path
  const output = join(workDir, `layer-${index}-${layer.layerId}.png`)
  const svg = readFileSync(layer.path, 'utf8')
  writeFileSync(output, Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: Math.max(1, layer.width) } }).render().asPng()))
  return output
}

function layerTextFilter({ current, layer, workDir, index, durationSeconds }) {
  const text = layer.text || ''
  if (!text) return { chain: '', label: current }
  const lines = wrapText(text, Math.max(8, Math.round(layer.width / Math.max(1, layer.fontSize * 0.56))), 8)
  const motion = layerMotionExpressions(layer, durationSeconds)
  const fontFile = motionFontFile()
  const x = layer.align === 'center' ? `${motion.x}+${layer.width}/2-text_w/2` : layer.align === 'right' ? `${motion.x}+${layer.width}-text_w` : motion.x
  let label = current
  const chains = []
  const lineHeight = Math.round(layer.fontSize * 1.15)
  lines.forEach((line, lineIndex) => {
    const path = join(workDir, `layer-${index}-${layer.layerId}-${lineIndex}.txt`)
    writeFileSync(path, line)
    const output = `[${layer.layerId}-text-${lineIndex}]`
    const options = [
      fontFile ? `fontfile='${escapeFilterValue(fontFile)}'` : "font='Arial'",
      `textfile='${escapeFilterValue(path)}'`,
      `fontcolor=${layerColor(layer.color)}`,
      `fontsize=${layer.fontSize}`,
      `x='${x}'`,
      `y='(${motion.y})+${lineIndex * lineHeight}'`,
      `alpha='${motion.alpha}'`,
      `enable='between(t,${(layer.startMs / 1000).toFixed(3)},${Math.min(durationSeconds, layer.endMs / 1000).toFixed(3)})'`
    ]
    chains.push(`${label}drawtext=${options.join(':')}${output}`)
    label = output
  })
  return { chain: chains.join(';'), label }
}

async function resolveMotionTextTone(path, requested = 'auto') {
  const tone = normalizeMotionTextTone(requested)
  if (tone !== 'auto') return tone
  try {
    const buffer = readFileSync(path)
    assertProcessableImageBuffer(buffer)
    const image = await Jimp.read(buffer)
    image.resize(1, 1)
    const { r, g, b } = Jimp.intToRGBA(image.getPixelColor(0, 0))
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return luminance > 0.58 ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export async function renderMotionVideo({ sourcePath, scenes = [], audioPath = '', logoPath = '', backgroundPath = '', site = 'escarlet', title = '', text = '', durationSeconds = 8, renderMode = 'layered_motion', backgroundMode = 'blurred_source', motionPreset = 'subtle_editorial', transition = {}, backgroundColor = '#2A9D8F', formatProfile = '', width = 0, height = 0, ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', ffprobePath = process.env.FFPROBE_PATH || 'ffprobe' } = {}) {
  if (!sourcePath || !existsSync(sourcePath)) throw Object.assign(new Error('El asset fuente no está disponible en el almacenamiento local.'), { code: 'motion_source_unavailable', status: 409 })
  if (audioPath && !existsSync(audioPath)) throw Object.assign(new Error('El audio del Reel no está disponible en el almacenamiento local.'), { code: 'motion_audio_unavailable', status: 409 })
  if (backgroundPath && !existsSync(backgroundPath)) throw Object.assign(new Error('El fondo del Reel no está disponible en el almacenamiento local.'), { code: 'motion_background_unavailable', status: 409 })
  const timeline = normalizeMotionScenes({ scenes, sourcePath, title, text, durationSeconds, renderMode, backgroundMode, motionPreset, transition, formatProfile, width, height })
  const workDir = join(tmpdir(), `escarlet-motion-${randomUUID()}`)
  mkdirSync(workDir, { recursive: true })
  const sceneFiles = []
  const outputPath = join(workDir, 'reel.mp4')
  try {
    const logo = logoPath && existsSync(logoPath) ? readFileSync(logoPath) : null
    const globalBackground = backgroundPath && existsSync(backgroundPath) ? readFileSync(backgroundPath) : null
    for (const [index, scene] of timeline.scenes.entries()) {
      if (!existsSync(scene.path)) throw Object.assign(new Error(`El asset de la escena ${scene.sceneId} no está disponible: ${scene.path}`), { code: 'motion_scene_asset_unavailable', status: 409 })
      const source = readFileSync(scene.path)
      const sceneBackgroundPath = scene.backgroundPath && existsSync(scene.backgroundPath)
        ? scene.backgroundPath
        : globalBackground
          ? backgroundPath
          : timeline.backgroundMode === 'blurred_source'
            ? scene.path
            : ''
      const sceneBackground = sceneBackgroundPath ? readFileSync(sceneBackgroundPath) : null
      const textTone = await resolveMotionTextTone(sceneBackgroundPath || scene.path, scene.textTone)
      const hasLayerText = scene.layers.some((layer) => layer.type === 'text' && layer.text)
      const layerGraph = scene.layers.map((layer, layerIndex) => ({
        ...layer,
        path: materializeMotionLayer(layer, workDir, `${index}-${layerIndex}`)
      })).filter((layer) => layer.type === 'text' || layer.type === 'shape' || layer.path)
      if (timeline.renderMode === 'layered_motion' && logo && !layerGraph.some((layer) => layer.type === 'logo' || layer.role === 'logo')) {
        const logoLayer = normalizeMotionLayers([{ type: 'logo', role: 'logo', path: logoPath, x: timeline.width - (timeline.width > timeline.height ? 420 : 388), y: timeline.height - (timeline.width > timeline.height ? 110 : 168), width: timeline.width > timeline.height ? 300 : 300, height: 70, animation: 'fade' }], timeline)[0]
        layerGraph.push({ ...logoLayer, path: materializeMotionLayer(logoLayer, workDir, `${index}-logo`) })
      }
      const svg = buildMotionSceneSvg({
        imageBase64: source.toString('base64'),
        imageMime: mediaMime(scene.path),
        backgroundBase64: sceneBackground?.toString('base64') || '',
        backgroundMime: sceneBackground ? mediaMime(sceneBackgroundPath) : 'image/jpeg',
        logoBase64: timeline.renderMode === 'layered_motion' && layerGraph.length === 0 ? logo?.toString('base64') || '' : '',
        logoMime: logo ? mediaMime(logoPath, 'image/svg+xml') : 'image/svg+xml',
        site,
        title: scene.title,
        text: scene.body,
        fit: scene.fit,
        renderMode: timeline.renderMode,
        backgroundMode: timeline.backgroundMode,
        backgroundColor,
        includeText: timeline.renderMode !== 'layered_motion' || (scene.textAnimation === 'none' && !hasLayerText),
        textPosition: scene.textPosition,
        textTone,
        width: timeline.width,
        height: timeline.height
      })
      const scenePath = join(workDir, `scene-${String(index + 1).padStart(3, '0')}.png`)
      writeFileSync(scenePath, Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: timeline.width } }).render().asPng()))
      sceneFiles.push({ path: scenePath, durationMs: scene.durationMs, title: scene.title, body: scene.body, motionPreset: scene.motionPreset, textAnimation: scene.textAnimation, textPosition: scene.textPosition, textTone, layers: layerGraph.map((layer) => ({ ...layer, layerId: `${index}-${layer.layerId}` })) })
    }
    const totalSeconds = timeline.totalMs / 1000
    const transitionSeconds = timeline.transition.durationMs / 1000
    const useTransitionGraph = sceneFiles.length > 1 && timeline.transition.type !== 'none' && transitionSeconds > 0
    const useFilterGraph = useTransitionGraph || timeline.renderMode === 'layered_motion'
    const audioInputIndex = sceneFiles.reduce((total, scene) => total + 1 + scene.layers.filter((layer) => layer.type !== 'text' && layer.type !== 'shape' && layer.path).length, 0)
    const args = ['-hide_banner', '-loglevel', 'error', '-y']
    if (useFilterGraph) {
      sceneFiles.forEach((scene) => {
        args.push('-loop', '1', '-framerate', '30', '-t', (scene.durationMs / 1000).toFixed(3), '-i', scene.path)
        scene.layers.filter((layer) => layer.type !== 'text' && layer.type !== 'shape' && layer.path).forEach((layer) => {
          args.push('-loop', '1', '-framerate', '30', '-t', (scene.durationMs / 1000).toFixed(3), '-i', layer.path)
        })
      })
    } else {
      const concatPath = join(workDir, 'scenes.txt')
      const concatLines = sceneFiles.flatMap((scene) => [`file '${scene.path.replaceAll("'", "'\\''")}'`, `duration ${(scene.durationMs / 1000).toFixed(3)}`])
      concatLines.push(`file '${sceneFiles.at(-1).path.replaceAll("'", "'\\''")}'`)
      writeFileSync(concatPath, `${concatLines.join('\n')}\n`)
      args.push('-f', 'concat', '-safe', '0', '-i', concatPath)
    }
    if (audioPath) args.push('-i', audioPath)
    if (useFilterGraph) {
      const filters = []
      const sceneInputIndexes = []
      let nextInputIndex = 0
      sceneFiles.forEach((scene) => {
        const sceneInputIndex = nextInputIndex
        sceneInputIndexes.push({ sceneInputIndex, layerInputIndexes: [] })
        nextInputIndex += 1
        scene.layers.filter((layer) => layer.type !== 'text' && layer.type !== 'shape' && layer.path).forEach(() => {
          sceneInputIndexes.at(-1).layerInputIndexes.push(nextInputIndex)
          nextInputIndex += 1
        })
      })
      sceneFiles.forEach((scene, index) => {
        const sceneMotionPreset = scene.motionPreset || timeline.motionPreset
        const motion = timeline.renderMode === 'layered_motion' && sceneMotionPreset !== 'none'
          ? `zoompan=z='min(zoom+${sceneMotionPreset === 'dynamic_editorial' ? 0.0007 : 0.0003},${sceneMotionPreset === 'dynamic_editorial' ? 1.03 : 1.01})':x='iw/2-(iw/zoom/2)+${sceneMotionPreset === 'dynamic_editorial' ? '14*sin(on/18)' : '4*sin(on/24)'}':y='ih/2-(ih/zoom/2)+${sceneMotionPreset === 'dynamic_editorial' ? '10*cos(on/20)' : '3*cos(on/25)'}':d=1:s=${timeline.width}x${timeline.height}:fps=30`
          : 'fps=30'
        const textOverlay = timeline.renderMode === 'layered_motion' && !scene.layers.some((layer) => layer.type === 'text' && layer.text)
        const inputInfo = sceneInputIndexes[index]
        let sceneChain = `[${inputInfo.sceneInputIndex}:v]${motion},settb=AVTB,setpts=PTS-STARTPTS`
        if (textOverlay) sceneChain += `,${motionTextOverlay({ scene, index, workDir, site, width: timeline.width, height: timeline.height })}`
        sceneChain += ',format=rgba'
        filters.push(`${sceneChain}[v${index}]`)
        let current = `[v${index}]`
        let layerInputOffset = 0
        for (const layer of scene.layers) {
          if (layer.type === 'text') {
            const textFilter = layerTextFilter({ current, layer, workDir, index, durationSeconds: scene.durationMs / 1000 })
            if (textFilter.chain) filters.push(textFilter.chain)
            current = textFilter.label
            continue
          }
          if (layer.type === 'shape') {
            const motionLayer = layerMotionExpressions(layer, scene.durationMs / 1000)
            const start = (layer.startMs / 1000).toFixed(3)
            const end = Math.min(scene.durationMs / 1000, layer.endMs / 1000).toFixed(3)
            filters.push(`${current}drawbox=x='${motionLayer.x}':y='${motionLayer.y}':w=${layer.width}:h=${layer.height}:color=${layerColor(layer.color)}@${layer.opacity}:t=fill:enable='between(t,${start},${end})'[${layer.layerId}-shape]`)
            current = `[${layer.layerId}-shape]`
            continue
          }
          if (!layer.path) continue
          const inputIndex = inputInfo.layerInputIndexes[layerInputOffset]
          layerInputOffset += 1
          const inputLabel = `layer-${layer.layerId}`
          filters.push(layerInputFilter({ layer, inputIndex, durationSeconds: scene.durationMs / 1000 }))
          filters.push(layerOverlayFilter({ current, layer, inputLabel, durationSeconds: scene.durationMs / 1000 }))
          current = `[${layer.layerId}-out]`
        }
        filters.push(`${current}format=yuv420p[scene${index}]`)
      })
      let current = '[scene0]'
      let elapsed = sceneFiles[0].durationMs / 1000
      if (useTransitionGraph) {
        for (let index = 1; index < sceneFiles.length; index += 1) {
          const output = `[x${index}]`
          const xfade = timeline.transition.type === 'crossfade' ? 'fade' : timeline.transition.type
          filters.push(`${current}[scene${index}]xfade=transition=${xfade}:duration=${transitionSeconds.toFixed(3)}:offset=${Math.max(0, elapsed - transitionSeconds).toFixed(3)}${output}`)
          current = output
          elapsed += sceneFiles[index].durationMs / 1000 - transitionSeconds
        }
        const pad = transitionSeconds * (sceneFiles.length - 1)
        filters.push(`${current}tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},format=yuv420p[vout]`)
      } else if (sceneFiles.length > 1) {
        filters.push(`${sceneFiles.map((_, index) => `[scene${index}]`).join('')}concat=n=${sceneFiles.length}:v=1:a=0,format=yuv420p[vout]`)
      } else {
        filters.push(`${current}format=yuv420p[vout]`)
      }
      args.push('-filter_complex', filters.join(';'), '-map', '[vout]')
    } else {
      args.push('-vf', 'fps=30,format=yuv420p', '-map', '0:v:0')
    }
    args.push('-t', totalSeconds.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-b:v', '4M', '-minrate', '4M', '-maxrate', '4M', '-bufsize', '8M', '-x264-params', 'nal-hrd=cbr:force-cfr=1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart')
    if (audioPath) args.push('-map', `${useFilterGraph ? audioInputIndex : 1}:a:0?`, '-af', 'apad', '-c:a', 'aac', '-b:a', '192k')
    args.push(outputPath)
    await run(ffmpegPath, args)
    const probe = JSON.parse(await runCapture(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath]))
    const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video')
    const audioStream = (probe.streams || []).find((stream) => stream.codec_type === 'audio')
    const actualDuration = Number(probe.format?.duration || videoStream?.duration || 0)
    const actualBitrate = Number(videoStream?.bit_rate || 0)
    if (!videoStream || Number(videoStream.width) !== timeline.width || Number(videoStream.height) !== timeline.height || (audioPath && !audioStream) || Math.abs(actualDuration - totalSeconds) > 0.25 || (actualBitrate > 0 && actualBitrate < 2500000)) {
      throw Object.assign(new Error(`El render no pasó QA: ${videoStream?.width || '?'}x${videoStream?.height || '?'}, ${actualDuration.toFixed(3)}s, ${actualBitrate || '?'} bps.`), { code: 'motion_qa_failed', status: 422, details: { expectedDuration: totalSeconds, actualDuration, width: videoStream?.width, height: videoStream?.height, actualBitrate } })
    }
    await validateTransitionSamples({ ffmpegPath, outputPath, sceneFiles, transitionSeconds: useTransitionGraph ? transitionSeconds : 0, workDir })
    return readFileSync(outputPath)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
