import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {extname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {bundle} from '@remotion/bundler'
import {getCompositions, renderMedia} from '@remotion/renderer'

const IMAGE_MIME = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
})
const AUDIO_MIME = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg'
})
let bundlePromise

function remotionError(message, code = 'remotion_render_failed', status = 502) {
  return Object.assign(new Error(message), {code, status})
}

function dataUrl(path, mimeMap) {
  // shortcut: data URLs keep private media out of the browser, upgrade to a per-job publicDir for very large assets.
  const extension = extname(path).toLowerCase()
  const mime = mimeMap[extension]
  if (!mime) throw remotionError(`Remotion no admite el asset ${path} en este renderer.`, 'remotion_asset_unsupported', 422)
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

function imageDataUrl(path, required = false) {
  if (!path) return ''
  try {
    return dataUrl(path, IMAGE_MIME)
  } catch (error) {
    if (!required && error.code === 'remotion_asset_unsupported') return ''
    throw error
  }
}

function audioDataUrl(path) {
  return path ? dataUrl(path, AUDIO_MIME) : ''
}

function collectLayerAssets(scene) {
  return (scene.layers || []).map((layer) => {
    if (!layer.path || !['image', 'logo'].includes(layer.type)) return {...layer}
    return {...layer, dataUrl: imageDataUrl(layer.path, true)}
  })
}

async function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: fileURLToPath(new URL('./remotion-entry.jsx', import.meta.url)),
      rootDir: fileURLToPath(new URL('../', import.meta.url)),
      publicDir: null,
      enableCaching: true
    }).catch((error) => {
      bundlePromise = null
      throw error
    })
  }
  return bundlePromise
}

export async function renderRemotionVideo({timeline, sourcePath, scenes = [], audioPath = '', logoPath = '', site = 'escarlet', backgroundColor = '#2A9D8F', fps = 30} = {}) {
  if (!timeline || !Array.isArray(timeline.scenes) || !timeline.scenes.length) throw remotionError('Remotion necesita un timeline de escenas válido.', 'motion_timeline_invalid', 422)
  const inputScenes = timeline.scenes.map((scene, index) => {
    const source = scenes[index]?.path || scene.path || sourcePath
    const background = scenes[index]?.backgroundPath || scene.backgroundPath || ''
    return {
      ...scene,
      dataUrl: imageDataUrl(source, true),
      backgroundDataUrl: imageDataUrl(background),
      layers: collectLayerAssets(scene),
      renderMode: timeline.renderMode
    }
  })
  const inputProps = {
    scenes: inputScenes,
    site,
    logoDataUrl: imageDataUrl(logoPath),
    audioDataUrl: audioDataUrl(audioPath),
    backgroundColor,
    width: timeline.width,
    height: timeline.height,
    fps: Number(fps) > 0 ? Number(fps) : 30
  }
  const workDir = mkdtempSync(join(tmpdir(), 'escarlet-remotion-'))
  const outputPath = join(workDir, 'reel.mp4')
  try {
    const serveUrl = await getBundle()
    const compositions = await getCompositions(serveUrl, {inputProps})
    const composition = compositions.find((entry) => entry.id === 'EscarletMotion')
    if (!composition) throw remotionError('La composición EscarletMotion no está disponible.', 'remotion_composition_missing', 502)
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      imageFormat: 'jpeg',
      pixelFormat: 'yuv420p',
      videoBitrate: '4M',
      audioBitrate: audioPath ? '192k' : undefined,
      concurrency: Math.max(1, Math.min(4, Number(process.env.MOTION_REMOTION_CONCURRENCY || 2)))
    })
    return {
      buffer: readFileSync(outputPath),
      qa: {passed: true, engine: 'remotion'},
      output: {engine: 'remotion', width: timeline.width, height: timeline.height, fps: inputProps.fps, durationMs: timeline.totalMs},
      profile: {formatProfile: timeline.formatProfile, width: timeline.width, height: timeline.height, fps: inputProps.fps}
    }
  } finally {
    rmSync(workDir, {recursive: true, force: true})
  }
}

