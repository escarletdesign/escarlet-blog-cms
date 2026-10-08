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
  '.gif': 'image/gif'
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

export function buildMotionSvg({ imageBase64, imageMime = 'image/jpeg', site = 'escarlet', title = '', text = '', width = 1080, height = 1920 } = {}) {
  const image = String(imageBase64 || '').trim()
  const href = image ? `data:${imageMime};base64,${image}` : ''
  const titleLines = wrapText(title || 'Reel de marca', 22, 2)
  const bodyLines = wrapText(text, 42, 4)
  const imageMarkup = href
    ? `<image href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${width}" height="${height}" fill="#1E1E1E"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${imageMarkup}<rect width="${width}" height="${height}" fill="rgba(0,0,0,.14)"/><rect x="0" y="${height - 780}" width="${width}" height="780" fill="rgba(0,0,0,.72)"/><rect x="88" y="${height - 690}" width="132" height="16" rx="8" fill="#E8B73A"/><text x="88" y="${height - 620}" font-family="Arial, sans-serif" font-size="22px" font-weight="700" letter-spacing="4" fill="#FFFFFF">${escapeXml(String(site || 'brand').toUpperCase())}</text>${textBlock(titleLines, { x: 88, y: height - 520, size: 82, lineHeight: 88, weight: 700, fill: '#FFFFFF' })}${textBlock(bodyLines, { x: 88, y: height - 300, size: 38, lineHeight: 48, weight: 400, fill: '#FFFFFF' })}</svg>`
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

function mediaMime(path, fallback = 'image/jpeg') {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] || fallback
}

export async function renderMotionVideo({ sourcePath, audioPath = '', site = 'escarlet', title = '', text = '', durationSeconds = 8, ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  if (!sourcePath || !existsSync(sourcePath)) throw Object.assign(new Error('El asset fuente no está disponible en el almacenamiento local.'), { code: 'motion_source_unavailable', status: 409 })
  if (audioPath && !existsSync(audioPath)) throw Object.assign(new Error('El audio del Reel no está disponible en el almacenamiento local.'), { code: 'motion_audio_unavailable', status: 409 })
  const workDir = join(tmpdir(), `escarlet-motion-${randomUUID()}`)
  mkdirSync(workDir, { recursive: true })
  const overlayPath = join(workDir, 'frame.png')
  const outputPath = join(workDir, 'reel.mp4')
  try {
    const source = readFileSync(sourcePath)
    const svg = buildMotionSvg({ imageBase64: source.toString('base64'), imageMime: mediaMime(sourcePath), site, title, text })
    writeFileSync(overlayPath, Buffer.from(new Resvg(svg).render().asPng()))
    const duration = Math.min(Math.max(Number(durationSeconds) || 8, 3), 30)
    const fadeOutStart = Math.max(0, duration - 0.4).toFixed(2)
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', overlayPath]
    if (audioPath) args.push('-i', audioPath)
    args.push('-t', String(duration), '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOutStart}:d=0.4`, '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
    if (audioPath) args.push('-map', '0:v:0', '-map', '1:a:0?', '-c:a', 'aac', '-shortest')
    args.push(outputPath)
    await run(ffmpegPath, args)
    return readFileSync(outputPath)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
