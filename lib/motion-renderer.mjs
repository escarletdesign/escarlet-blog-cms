import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

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
function wrapText(value, maxChars, maxLines) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
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

function textBlock(lines, { x, y, size, lineHeight, weight, fill }) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-family="Arial, sans-serif" font-size="${size}px" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`).join('')
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

function normalizeDurationMs(value, fallback = 4000) {
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? Math.min(120000, Math.round(duration)) : fallback
}

export function normalizeMotionScenes({ scenes = [], sourcePath = '', title = '', text = '', durationSeconds = 8, renderMode = 'layered_motion' } = {}) {
  const mode = MOTION_RENDER_MODES.has(String(renderMode)) ? String(renderMode) : 'layered_motion'
  const declared = Array.isArray(scenes) && scenes.length
    ? scenes
    : [{ path: sourcePath, title, body: text, durationMs: Math.max(3000, Math.round((Number(durationSeconds) || 8) * 1000)) }]
  const normalized = declared.map((scene, index) => {
    const value = scene && typeof scene === 'object' ? scene : {}
    const path = String(value.path || value.sourcePath || '').trim()
    if (!path) throw Object.assign(new Error(`La escena ${index + 1} no tiene un asset resoluble.`), { code: 'motion_scene_asset_missing', status: 409 })
    const fit = MOTION_FITS.has(String(value.fit || 'contain')) ? String(value.fit || 'contain') : 'contain'
    return {
      path,
      fit,
      durationMs: normalizeDurationMs(value.durationMs),
      title: String(value.title || value.headline || '').trim().slice(0, 160),
      body: String(value.body || value.text || '').trim().slice(0, 1000),
      sceneId: String(value.sceneId || `scene-${index + 1}`).trim().slice(0, 120)
    }
  })
  const totalMs = normalized.reduce((sum, scene) => sum + scene.durationMs, 0)
  if (!normalized.length || totalMs < 1000) throw Object.assign(new Error('El timeline de motion debe contener al menos una escena válida.'), { code: 'motion_timeline_invalid', status: 422 })
  return { renderMode: mode, scenes: normalized, totalMs }
}

export function buildMotionSceneSvg({ imageBase64, imageMime = 'image/jpeg', logoBase64 = '', logoMime = 'image/svg+xml', site = 'escarlet', title = '', text = '', width = 1080, height = 1920, fit = 'contain', renderMode = 'layered_motion', backgroundColor = '#303030' } = {}) {
  const image = String(imageBase64 || '').trim()
  const href = image ? `data:${imageMime};base64,${image}` : ''
  const logo = String(logoBase64 || '').trim()
  const logoHref = logo ? `data:${logoMime};base64,${logo}` : ''
  const preserveAspectRatio = fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
  const imageMarkup = href
    ? `<rect width="${width}" height="${height}" fill="${escapeXml(backgroundColor)}"/><image href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${preserveAspectRatio}"/>`
    : `<rect width="${width}" height="${height}" fill="${escapeXml(backgroundColor)}"/>`
  if (renderMode === 'flat_slides') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${imageMarkup}</svg>`
  }
  const titleLines = wrapText(title || 'Reel de marca', 22, 2)
  const bodyLines = wrapText(text, 42, 4)
  const logoMarkup = logoHref ? `<image href="${logoHref}" x="${width - 388}" y="${height - 168}" width="300" height="70" preserveAspectRatio="xMidYMid meet"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="motionShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.78"/></linearGradient></defs>${imageMarkup}<rect width="${width}" height="${height}" fill="url(#motionShade)"/><rect x="88" y="${height - 690}" width="132" height="16" rx="8" fill="#E8B73A"/><text x="88" y="${height - 620}" font-family="Arial, sans-serif" font-size="22px" font-weight="700" letter-spacing="4" fill="#FFFFFF">${escapeXml(String(site || 'brand').toUpperCase())}</text>${textBlock(titleLines, { x: 88, y: height - 520, size: 82, lineHeight: 88, weight: 700, fill: '#FFFFFF' })}${textBlock(bodyLines, { x: 88, y: height - 300, size: 38, lineHeight: 48, weight: 400, fill: '#FFFFFF' })}${logoMarkup}</svg>`
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

function mediaMime(path, fallback = 'image/jpeg') {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] || fallback
}

export async function renderMotionVideo({ sourcePath, scenes = [], audioPath = '', logoPath = '', site = 'escarlet', title = '', text = '', durationSeconds = 8, renderMode = 'layered_motion', backgroundColor = '#303030', ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', ffprobePath = process.env.FFPROBE_PATH || 'ffprobe' } = {}) {
  if (!sourcePath || !existsSync(sourcePath)) throw Object.assign(new Error('El asset fuente no está disponible en el almacenamiento local.'), { code: 'motion_source_unavailable', status: 409 })
  if (audioPath && !existsSync(audioPath)) throw Object.assign(new Error('El audio del Reel no está disponible en el almacenamiento local.'), { code: 'motion_audio_unavailable', status: 409 })
  const timeline = normalizeMotionScenes({ scenes, sourcePath, title, text, durationSeconds, renderMode })
  const workDir = join(tmpdir(), `escarlet-motion-${randomUUID()}`)
  mkdirSync(workDir, { recursive: true })
  const sceneFiles = []
  const outputPath = join(workDir, 'reel.mp4')
  try {
    const logo = logoPath && existsSync(logoPath) ? readFileSync(logoPath) : null
    for (const [index, scene] of timeline.scenes.entries()) {
      if (!existsSync(scene.path)) throw Object.assign(new Error(`El asset de la escena ${scene.sceneId} no está disponible: ${scene.path}`), { code: 'motion_scene_asset_unavailable', status: 409 })
      const source = readFileSync(scene.path)
      const svg = buildMotionSceneSvg({
        imageBase64: source.toString('base64'),
        imageMime: mediaMime(scene.path),
        logoBase64: timeline.renderMode === 'layered_motion' ? logo?.toString('base64') || '' : '',
        logoMime: logo ? mediaMime(logoPath, 'image/svg+xml') : 'image/svg+xml',
        site,
        title: scene.title,
        text: scene.body,
        fit: scene.fit,
        renderMode: timeline.renderMode,
        backgroundColor
      })
      const scenePath = join(workDir, `scene-${String(index + 1).padStart(3, '0')}.png`)
      writeFileSync(scenePath, Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng()))
      sceneFiles.push({ path: scenePath, durationMs: scene.durationMs })
    }
    const concatPath = join(workDir, 'scenes.txt')
    const concatLines = sceneFiles.flatMap((scene) => [`file '${scene.path.replaceAll("'", "'\\''")}'`, `duration ${(scene.durationMs / 1000).toFixed(3)}`])
    concatLines.push(`file '${sceneFiles.at(-1).path.replaceAll("'", "'\\''")}'`)
    writeFileSync(concatPath, `${concatLines.join('\n')}\n`)
    const totalSeconds = timeline.totalMs / 1000
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatPath]
    if (audioPath) args.push('-i', audioPath)
    args.push('-t', totalSeconds.toFixed(3), '-vf', 'fps=30,format=yuv420p', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-b:v', '4M', '-minrate', '3M', '-maxrate', '6M', '-bufsize', '8M', '-x264-params', 'nal-hrd=vbr:force-cfr=1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map', '0:v:0')
    if (audioPath) args.push('-map', '1:a:0?', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k')
    args.push(outputPath)
    await run(ffmpegPath, args)
    const probe = JSON.parse(await runCapture(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath]))
    const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video')
    const audioStream = (probe.streams || []).find((stream) => stream.codec_type === 'audio')
    const actualDuration = Number(probe.format?.duration || videoStream?.duration || 0)
    if (!videoStream || Number(videoStream.width) !== 1080 || Number(videoStream.height) !== 1920 || (audioPath && !audioStream) || Math.abs(actualDuration - totalSeconds) > 0.25) {
      throw Object.assign(new Error(`El render no pasó QA: ${videoStream?.width || '?'}x${videoStream?.height || '?'}, ${actualDuration.toFixed(3)}s.`), { code: 'motion_qa_failed', status: 422, details: { expectedDuration: totalSeconds, actualDuration, width: videoStream?.width, height: videoStream?.height } })
    }
    return readFileSync(outputPath)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
