/**
 * Genera packs admin para publicar manualmente en Substack, X y LinkedIn.
 * Plantilla canónica. vive en escarlet-blog-cms/templates/frontend/
 * Copia a scripts/ del frontend. Salida. public/admin/blog-packs/
 *
 * Env (opcionales).
 *   BLOG_SITE_URL       https://tu-dominio.com
 *   BLOG_PACKS_NAME     Packs Escarlet
 *   BLOG_PACKS_THEME    #47a4e7
 *   BLOG_PACKS_ICON     /icono.png
 *   BLOG_PACKS_ICON_192 /icons/pwa/icon-192.png
 *   BLOG_PACKS_ICON_512 /icons/pwa/icon-512.png
 *   BLOG_PACKS_ICON_180 /icons/pwa/icon-180.png
 *   BLOG_PACKS_CHANNELS substack,linkedin,x,videoScript,instagramCarousel
 *
 * Uso: node scripts/generate-blog-social-packs.mjs
 */
import { mkdirSync, writeFileSync, existsSync, copyFileSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as blogData from '../src/data/blog-articles.js'

const { getAllBlogPosts, getPostCanonicalUrl } = blogData
const SYNCED_CHANNELS = blogData.SOCIAL_PACK_CHANNELS

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outRoot = join(root, 'public', 'admin', 'blog-packs')
const SITE = (process.env.BLOG_SITE_URL || 'https://example.com').replace(/\/$/, '')
const THEME_COLOR = process.env.BLOG_PACKS_THEME || '#47a4e7'
const PACKS_NAME = process.env.BLOG_PACKS_NAME || 'Packs blog'
const ICON = process.env.BLOG_PACKS_ICON || '/favicon.png'
const ICON_192 = process.env.BLOG_PACKS_ICON_192 || ICON
const ICON_512 = process.env.BLOG_PACKS_ICON_512 || ICON
const ICON_180 = process.env.BLOG_PACKS_ICON_180 || ICON

function adminPwaHead({ title, description }) {
  return `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="${THEME_COLOR}">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="${escapeHtml(PACKS_NAME)}">
  <meta name="application-name" content="${escapeHtml(PACKS_NAME)}">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/png" href="${ICON}">
  <link rel="icon" type="image/png" sizes="192x192" href="${ICON_192}">
  <link rel="icon" type="image/png" sizes="512x512" href="${ICON_512}">
  <link rel="apple-touch-icon" href="${ICON_180}">
  <link rel="manifest" href="/admin/blog-packs/manifest.webmanifest">`
}

function adminManifestJson() {
  return `${JSON.stringify(
    {
      id: '/admin/blog-packs/',
      name: PACKS_NAME,
      short_name: 'Packs',
      description: `Packs de publicación del blog (${PACKS_NAME}) para el equipo.`,
      start_url: '/admin/blog-packs/',
      scope: '/admin/blog-packs/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#f6f4f1',
      theme_color: THEME_COLOR,
      lang: 'es',
      icons: [
        {
          src: ICON_192,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: ICON_512,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: ICON_512,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    },
    null,
    2
  )}\n`
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resolveImagePaths(imageUrl) {
  if (!imageUrl || imageUrl.startsWith('http')) {
    return { webAbs: imageUrl || '', localWebp: null, localJpg: null, downloadRel: imageUrl || '' }
  }
  const publicPath = join(root, 'public', imageUrl.replace(/^\//, ''))
  const dir = dirname(publicPath)
  const base = basename(publicPath, extname(publicPath))
  const webp = join(dir, `${base}.webp`)
  const jpg = join(dir, `${base}.jpg`)
  const png = join(dir, `${base}.png`)
  const localWebp = existsSync(webp) ? webp : null
  const localJpg = existsSync(jpg) ? jpg : existsSync(png) ? png : null
  return {
    webAbs: `${SITE}${imageUrl}`,
    localWebp,
    localJpg,
    downloadRel: imageUrl
  }
}

function xCharCount(text) {
  // X cuenta cada URL http(s) como 23 caracteres
  return text.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23)).length
}

function normalizeSocialPack(socialPack, title) {
  const raw = socialPack || {}
  const videoScript = String(raw.videoScript || '').trim()
  const slides = Array.isArray(raw.instagramSlides)
    ? raw.instagramSlides
        .map((slide) => ({
          imageUrl: String(slide?.imageUrl || '').trim(),
          alt: String(slide?.alt || '').trim(),
          headline: String(slide?.headline || '').trim(),
          body: String(slide?.body || '').trim()
        }))
        .filter((slide) => slide.imageUrl || slide.headline || slide.body)
    : []
  return {
    substackTitle: raw.substackTitle || title,
    substackBody: raw.substackBody || '',
    linkedin: raw.linkedin || '',
    x: raw.x || '',
    videoScript,
    instagramCaption: String(raw.instagramCaption || '').trim(),
    instagramSlides: slides
  }
}

function parsePackChannelsEnv() {
  const raw = String(process.env.BLOG_PACKS_CHANNELS || '').trim()
  if (!raw) return null
  const enabled = new Set(
    raw
      .split(/[,+\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  )
  return {
    substack: enabled.has('substack'),
    linkedin: enabled.has('linkedin'),
    x: enabled.has('x'),
    videoScript: enabled.has('video') || enabled.has('videoScript'),
    instagramCarousel: enabled.has('instagram') || enabled.has('instagramCarousel')
  }
}

function resolvePackChannels() {
  const fromEnv = parsePackChannelsEnv()
  if (fromEnv) return fromEnv
  if (SYNCED_CHANNELS && typeof SYNCED_CHANNELS === 'object') {
    return {
      substack: SYNCED_CHANNELS.substack !== false,
      linkedin: SYNCED_CHANNELS.linkedin !== false,
      x: SYNCED_CHANNELS.x !== false,
      videoScript: SYNCED_CHANNELS.videoScript !== false,
      instagramCarousel: SYNCED_CHANNELS.instagramCarousel !== false
    }
  }
  return {
    substack: true,
    linkedin: true,
    x: true,
    videoScript: true,
    instagramCarousel: true
  }
}

const PACK_CHANNELS = resolvePackChannels()

function scriptStorageKey(slug) {
  return `escarlet-pack-edit:${slug}:videoScript`
}

/** Shared client helpers for pack + edit + recorder (localStorage override for guion only). */
function packClientHelpersJs(slug) {
  const key = JSON.stringify(scriptStorageKey(slug))
  return `
    const PACK_SLUG = ${JSON.stringify(slug)}
    const SCRIPT_STORAGE_KEY = ${key}
    function readStoredScript() {
      try {
        const value = localStorage.getItem(SCRIPT_STORAGE_KEY)
        return value == null ? null : String(value)
      } catch (e) {
        return null
      }
    }
    function writeStoredScript(text) {
      try {
        localStorage.setItem(SCRIPT_STORAGE_KEY, String(text ?? ''))
        return true
      } catch (e) {
        return false
      }
    }
    function clearStoredScript() {
      try {
        localStorage.removeItem(SCRIPT_STORAGE_KEY)
        return true
      } catch (e) {
        return false
      }
    }
    function getCanonicalScript() {
      const el = document.getElementById('video-canonical-json')
      if (!el) return ''
      try {
        return String(JSON.parse(el.textContent || '""') || '')
      } catch (e) {
        return ''
      }
    }
    function getLiveScript() {
      const stored = readStoredScript()
      return stored == null ? getCanonicalScript() : stored
    }
    function hasScriptOverride() {
      const stored = readStoredScript()
      if (stored == null) return false
      return stored !== getCanonicalScript()
    }
    function wordCount(text) {
      return String(text || '').trim().split(/\\s+/).filter(Boolean).length
    }
`
}

function videoScriptSection(pack, slug) {
  if (!pack.videoScript) return ''

  return `<section class="card card--featured" id="video">
  <header class="card__head">
    <div class="card__title-row">
      <h2>Guion para vídeo</h2>
      <span class="badge" id="video-edited-badge" hidden>Editado aquí</span>
    </div>
    <p class="muted">Antes de grabar. Léelo en voz alta. Las pausas van con saltos de párrafo.</p>
  </header>
  <p class="notice" id="video-ephemeral-notice" hidden>
    Hay una versión temporal en este dispositivo. Se pierde si borras datos del navegador o restauras el original.
  </p>
  <script type="application/json" id="video-canonical-json">${JSON.stringify(pack.videoScript)}</script>
  <div class="preview preview--script" data-preview data-lines="8">
    <div class="preview-text preview-text--script" id="video-body"></div>
    <button type="button" class="preview-more" data-toggle-preview hidden>Leer más</button>
  </div>
  <div class="actions actions--script">
    <a class="btn btn--primary" href="/admin/blog-packs/${escapeHtml(slug)}/edit">Editar guion</a>
    <button type="button" class="btn" data-copy-text="video-body">Copiar</button>
    <button type="button" class="btn btn--ghost" id="btn-restore-script" hidden>Restaurar original</button>
    <button type="button" class="btn btn--record" id="btn-record">Grabar</button>
  </div>
</section>`
}

function recorderMarkup(slug) {
  return `<div class="recorder" id="recorder" aria-hidden="true" data-mode="teleprompter">
  <div class="recorder__panel">
    <header class="recorder__head">
      <div class="recorder__title-row">
        <h2>Grabar guion</h2>
        <div class="recorder__head-actions">
          <button type="button" class="btn recorder__menu-btn" id="recorder-menu-btn" aria-expanded="false" aria-controls="recorder-menu" aria-label="Abrir menú">☰</button>
          <button type="button" class="btn recorder__icon-btn" id="recorder-close" aria-label="Cerrar">Cerrar</button>
        </div>
      </div>
      <div class="recorder__menu" id="recorder-menu" hidden>
        <p class="muted" id="recorder-hint">El guion ocupa la pantalla. La cámara queda detrás al grabar.</p>
        <p class="recorder__menu-label">Modo</p>
        <div class="recorder__modes" role="tablist" aria-label="Modo de vista">
          <button type="button" class="recorder__mode is-active" role="tab" aria-selected="true" data-mode="teleprompter">Teleprompter</button>
          <button type="button" class="recorder__mode" role="tab" aria-selected="false" data-mode="pip">Mini cámara</button>
          <button type="button" class="recorder__mode" role="tab" aria-selected="false" data-mode="split">Dividido</button>
          <button type="button" class="recorder__mode" role="tab" aria-selected="false" data-mode="nearcam">Cerca cámara</button>
        </div>
        <p class="recorder__menu-label">Velocidad</p>
        <div class="recorder__speed-row">
          <button type="button" class="btn recorder__tool" id="recorder-slower" aria-label="Bajar velocidad">−</button>
          <span class="recorder__speed" id="recorder-speed" aria-live="polite">Velocidad x1</span>
          <button type="button" class="btn recorder__tool" id="recorder-faster" aria-label="Subir velocidad">+</button>
        </div>
      </div>
    </header>
    <div class="recorder__viewport">
      <div class="recorder__stage" id="recorder-stage">
        <video class="recorder__preview" id="recorder-preview" playsinline muted autoplay></video>
        <div class="recorder__veil" aria-hidden="true"></div>
        <div class="recorder__countdown" id="recorder-countdown" hidden aria-live="assertive"></div>
        <p class="recorder__status" id="recorder-status"></p>
      </div>
      <div class="recorder__script" id="recorder-script" aria-live="polite"></div>
    </div>
    <button type="button" class="recorder__next" id="recorder-next" aria-label="Siguiente bloque">Siguiente</button>
    <div class="recorder__dock">
      <a class="btn recorder__download" id="recorder-download" hidden download="${escapeHtml(slug)}-guion.webm">Descargar</a>
      <button type="button" class="btn recorder__rec" id="recorder-start">Empezar</button>
      <button type="button" class="btn recorder__rec" id="recorder-stop" hidden>Detener</button>
    </div>
  </div>
</div>`
}

function recorderScript(slug) {
  const fileBase = JSON.stringify(`${slug}-guion.`)
  return `
    ;(function initRecorder() {
      const openBtn = document.getElementById('btn-record')
      const shell = document.getElementById('recorder')
      if (!openBtn || !shell) return

      const scriptEl = document.getElementById('recorder-script')
      const preview = document.getElementById('recorder-preview')
      const countdownEl = document.getElementById('recorder-countdown')
      const statusEl = document.getElementById('recorder-status')
      const hintEl = document.getElementById('recorder-hint')
      const speedEl = document.getElementById('recorder-speed')
      const menuBtn = document.getElementById('recorder-menu-btn')
      const menuEl = document.getElementById('recorder-menu')
      const startBtn = document.getElementById('recorder-start')
      const stopBtn = document.getElementById('recorder-stop')
      const downloadBtn = document.getElementById('recorder-download')
      const closeBtn = document.getElementById('recorder-close')
      const slowerBtn = document.getElementById('recorder-slower')
      const fasterBtn = document.getElementById('recorder-faster')
      const nextBtn = document.getElementById('recorder-next')
      const modeBtns = Array.from(shell.querySelectorAll('.recorder__mode'))
      const MODE_KEY = 'escarlet-recorder-mode'
      const SPEED_KEY = 'escarlet-recorder-speed'
      const NEXT_POS_KEY = 'escarlet-recorder-next-pos'
      const RECORDING_DB = 'escarlet-recorder'
      const RECORDING_STORE = 'last-takes'
      const recordingKey = ${JSON.stringify(slug)}
      const SPEED_STEPS = [0.7, 0.85, 1, 1.2, 1.45]
      const HINTS = {
        teleprompter: 'El guion ocupa la pantalla. La cámara queda detrás al grabar.',
        pip: 'El guion manda. La cámara se ve en miniatura sin quitar lectura.',
        split: 'Texto arriba, cerca de la cámara del móvil. Vídeo completo abajo.',
        nearcam: 'Texto pegado arriba, mirando a la cámara. Franja de vídeo abajo.'
      }

      let stream = null
      let recorder = null
      let chunks = []
      let objectUrl = null
      let countdownTimer = null
      let promptTimer = null
      let starting = false
      let lineEls = []
      let lineIndex = 0
      let speedFactor = 1
      let dragMoved = false

      function setStatus(text) {
        statusEl.textContent = text || ''
      }

      function setMenuOpen(open) {
        if (!menuEl || !menuBtn) return
        menuEl.hidden = !open
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
        menuBtn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú')
        menuBtn.textContent = open ? '✕' : '☰'
        shell.classList.toggle('is-menu-open', open)
      }

      function pickMimeType() {
        const candidates = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4'
        ]
        for (const type of candidates) {
          if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type
        }
        return ''
      }

      function resetDownload() {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl)
          objectUrl = null
        }
        downloadBtn.hidden = true
        downloadBtn.removeAttribute('href')
      }

      function openRecordingDb() {
        return new Promise((resolve, reject) => {
          if (!window.indexedDB) {
            reject(new Error('no-idb'))
            return
          }
          const req = indexedDB.open(RECORDING_DB, 1)
          req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(RECORDING_STORE)) {
              db.createObjectStore(RECORDING_STORE)
            }
          }
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error || new Error('idb-open'))
        })
      }

      async function saveLastRecording(blob, type, fileName) {
        try {
          const db = await openRecordingDb()
          await new Promise((resolve, reject) => {
            const tx = db.transaction(RECORDING_STORE, 'readwrite')
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
            tx.objectStore(RECORDING_STORE).put({
              blob,
              type,
              fileName,
              savedAt: Date.now()
            }, recordingKey)
          })
          db.close()
          return true
        } catch (e) {
          return false
        }
      }

      async function loadLastRecording() {
        try {
          const db = await openRecordingDb()
          const row = await new Promise((resolve, reject) => {
            const tx = db.transaction(RECORDING_STORE, 'readonly')
            const req = tx.objectStore(RECORDING_STORE).get(recordingKey)
            req.onsuccess = () => resolve(req.result || null)
            req.onerror = () => reject(req.error)
          })
          db.close()
          return row
        } catch (e) {
          return null
        }
      }

      async function clearLastRecording() {
        try {
          const db = await openRecordingDb()
          await new Promise((resolve, reject) => {
            const tx = db.transaction(RECORDING_STORE, 'readwrite')
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
            tx.objectStore(RECORDING_STORE).delete(recordingKey)
          })
          db.close()
        } catch (e) {}
      }

      function presentRecording(blob, type, fileName) {
        resetDownload()
        objectUrl = URL.createObjectURL(blob)
        downloadBtn.href = objectUrl
        downloadBtn.download = fileName
        downloadBtn.hidden = false
      }

      async function restoreSavedDownload() {
        const saved = await loadLastRecording()
        if (!saved || !saved.blob) return false
        const type = saved.type || saved.blob.type || 'video/webm'
        const ext = type.includes('mp4') ? 'mp4' : 'webm'
        const fileName = saved.fileName || (${fileBase} + ext)
        presentRecording(saved.blob, type, fileName)
        return true
      }

      function stopTracks() {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop())
          stream = null
        }
        preview.srcObject = null
      }

      function clearCountdown() {
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
        countdownEl.hidden = true
        countdownEl.textContent = ''
      }

      function stopPromptScroll() {
        if (promptTimer) {
          clearInterval(promptTimer)
          promptTimer = null
        }
      }

      function formatSpeed(factor) {
        const label = Number(factor).toFixed(2).replace(/\\.?0+$/, '')
        return 'Velocidad x' + label
      }

      function applySpeed(factor, restart) {
        const nearest = SPEED_STEPS.reduce((best, step) => {
          return Math.abs(step - factor) < Math.abs(best - factor) ? step : best
        }, SPEED_STEPS[2])
        speedFactor = nearest
        try { localStorage.setItem(SPEED_KEY, String(speedFactor)) } catch (e) {}
        if (speedEl) speedEl.textContent = formatSpeed(speedFactor)
        slowerBtn.disabled = SPEED_STEPS.indexOf(speedFactor) <= 0
        fasterBtn.disabled = SPEED_STEPS.indexOf(speedFactor) >= SPEED_STEPS.length - 1
        if (restart && shell.classList.contains('is-recording')) {
          startPromptScroll(false)
        }
      }

      function preferredSpeed() {
        try {
          const saved = Number(localStorage.getItem(SPEED_KEY))
          if (SPEED_STEPS.includes(saved)) return saved
        } catch (e) {}
        return 1
      }

      function changeSpeed(direction) {
        const idx = SPEED_STEPS.indexOf(speedFactor)
        const next = SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + direction))]
        applySpeed(next, true)
      }

      function renderScript(text) {
        scriptEl.textContent = ''
        lineEls = []
        lineIndex = 0
        const lines = String(text || '').replace(/\\r\\n/g, '\\n').split('\\n')
        lines.forEach((line) => {
          const empty = !String(line).trim()
          const el = document.createElement(empty ? 'div' : 'p')
          el.className = empty ? 'recorder__break' : 'recorder__line'
          el.textContent = empty ? '\\u00a0' : line
          if (!empty) lineEls.push(el)
          scriptEl.appendChild(el)
        })
        scriptEl.scrollTop = 0
      }

      function highlightLine(index) {
        lineEls.forEach((el, idx) => {
          el.classList.toggle('is-active', idx === index)
          el.classList.toggle('is-past', idx < index)
        })
        const active = lineEls[index]
        if (!active) return
        const mode = shell.dataset.mode
        const block = (mode === 'split' || mode === 'nearcam') ? 'start' : 'center'
        active.scrollIntoView({ behavior: 'smooth', block: block })
      }

      function liveScriptText() {
        if (typeof getLiveScript === 'function') return getLiveScript()
        const el = document.getElementById('video-body')
        return el ? String(el.textContent || '') : ''
      }

      function stepMsForScroll() {
        if (!lineEls.length) return 4000
        const words = String(liveScriptText())
          .trim()
          .split(/\\s+/)
          .filter(Boolean).length
        const baseSeconds = Math.max(40, Math.min(70, words / 2.2))
        const seconds = baseSeconds / speedFactor
        return (seconds * 1000) / Math.max(1, lineEls.length)
      }

      function startPromptScroll(resetIndex) {
        stopPromptScroll()
        if (!lineEls.length) return
        if (resetIndex !== false) {
          lineIndex = 0
          highlightLine(0)
        } else {
          highlightLine(lineIndex)
        }
        const stepMs = stepMsForScroll()
        promptTimer = setInterval(() => {
          lineIndex += 1
          if (lineIndex >= lineEls.length) {
            stopPromptScroll()
            return
          }
          highlightLine(lineIndex)
        }, stepMs)
      }

      function goToNextBlock() {
        if (!lineEls.length) return
        if (lineIndex >= lineEls.length - 1) {
          highlightLine(lineEls.length - 1)
          flash('Llegaste al final del guion')
          return
        }
        lineIndex += 1
        highlightLine(lineIndex)
        if (shell.classList.contains('is-recording')) {
          startPromptScroll(false)
        }
      }

      function updateOrientation() {
        if (!preview.videoWidth || !preview.videoHeight) return
        shell.dataset.orientation = preview.videoHeight > preview.videoWidth ? 'vertical' : 'horizontal'
      }

      function applyMode(mode) {
        const next = HINTS[mode] ? mode : 'teleprompter'
        shell.dataset.mode = next
        try { localStorage.setItem(MODE_KEY, next) } catch (e) {}
        if (hintEl) hintEl.textContent = HINTS[next]
        modeBtns.forEach((btn) => {
          const active = btn.getAttribute('data-mode') === next
          btn.classList.toggle('is-active', active)
          btn.setAttribute('aria-selected', active ? 'true' : 'false')
        })
        if (lineEls[lineIndex]) highlightLine(lineIndex)
      }

      function preferredMode() {
        try {
          const saved = localStorage.getItem(MODE_KEY)
          if (HINTS[saved]) return saved
        } catch (e) {}
        return 'teleprompter'
      }

      function clampNextPos(left, top) {
        const margin = 8
        const maxLeft = Math.max(margin, window.innerWidth - nextBtn.offsetWidth - margin)
        const maxTop = Math.max(margin, window.innerHeight - nextBtn.offsetHeight - margin)
        return {
          left: Math.min(maxLeft, Math.max(margin, left)),
          top: Math.min(maxTop, Math.max(margin, top))
        }
      }

      function placeNextBtn(left, top, save) {
        const pos = clampNextPos(left, top)
        nextBtn.style.left = pos.left + 'px'
        nextBtn.style.top = pos.top + 'px'
        nextBtn.style.right = 'auto'
        nextBtn.style.bottom = 'auto'
        if (save) {
          try { localStorage.setItem(NEXT_POS_KEY, JSON.stringify(pos)) } catch (e) {}
        }
      }

      function restoreNextBtn() {
        try {
          const saved = JSON.parse(localStorage.getItem(NEXT_POS_KEY) || '')
          if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
            placeNextBtn(saved.left, saved.top, false)
            return
          }
        } catch (e) {}
        const left = window.innerWidth - nextBtn.offsetWidth - 18
        const top = window.innerHeight - nextBtn.offsetHeight - 110
        placeNextBtn(left, top, false)
      }

      function bindNextDrag() {
        let dragging = false
        let pointerId = null
        let startX = 0
        let startY = 0
        let originLeft = 0
        let originTop = 0

        function onStart(event) {
          if (event.button != null && event.button !== 0) return
          dragging = true
          dragMoved = false
          pointerId = event.pointerId
          const rect = nextBtn.getBoundingClientRect()
          startX = event.clientX
          startY = event.clientY
          originLeft = rect.left
          originTop = rect.top
          nextBtn.classList.add('is-dragging')
          try { nextBtn.setPointerCapture(event.pointerId) } catch (e) {}
        }

        function onMove(event) {
          if (!dragging) return
          if (pointerId != null && event.pointerId !== pointerId) return
          const dx = event.clientX - startX
          const dy = event.clientY - startY
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dragMoved = true
          placeNextBtn(originLeft + dx, originTop + dy, false)
        }

        function onEnd(event) {
          if (!dragging) return
          if (event && pointerId != null && event.pointerId !== pointerId) return
          dragging = false
          pointerId = null
          nextBtn.classList.remove('is-dragging')
          const rect = nextBtn.getBoundingClientRect()
          placeNextBtn(rect.left, rect.top, true)
        }

        nextBtn.addEventListener('pointerdown', onStart)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onEnd)
        window.addEventListener('pointercancel', onEnd)
        nextBtn.addEventListener('click', (event) => {
          if (dragMoved) {
            event.preventDefault()
            event.stopPropagation()
            dragMoved = false
            return
          }
          goToNextBlock()
        })
      }

      async function openRecorder() {
        applyMode(preferredMode())
        applySpeed(preferredSpeed(), false)
        renderScript(liveScriptText())
        stopPromptScroll()
        setMenuOpen(false)
        shell.classList.remove('is-recording')
        const edited = typeof hasScriptOverride === 'function' && hasScriptOverride()
        setStatus(edited ? 'Preparando cámara · guion editado aquí' : 'Preparando cámara')
        startBtn.hidden = false
        stopBtn.hidden = true
        shell.classList.add('is-open')
        shell.setAttribute('aria-hidden', 'false')
        document.body.style.overflow = 'hidden'
        restoreNextBtn()
        const hadSaved = await restoreSavedDownload()
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus(hadSaved
            ? 'Último vídeo guardado. Este navegador no permite cámara.'
            : 'Este navegador no permite cámara')
          flash('Usa un navegador con cámara')
          return
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: {
              facingMode: { ideal: 'user' },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          })
          preview.srcObject = stream
          await preview.play().catch(() => {})
          updateOrientation()
          preview.onloadedmetadata = updateOrientation
          if (hadSaved) {
            setStatus(edited
              ? 'Listo. Vídeo pendiente. Guion editado aquí (temporal).'
              : 'Listo. Tienes un vídeo pendiente de descargar.')
          } else {
            setStatus(edited
              ? 'Listo para grabar · guion temporal en este dispositivo'
              : 'Listo para grabar')
          }
        } catch (err) {
          setStatus(hadSaved
            ? 'Último vídeo guardado. La cámara no abrió.'
            : 'La cámara no abrió. Puedes leer el guion igual.')
          flash('Permite el acceso a la cámara')
        }
      }

      function closeRecorder() {
        clearCountdown()
        stopPromptScroll()
        starting = false
        setMenuOpen(false)
        shell.classList.remove('is-recording')
        if (recorder && recorder.state !== 'inactive') {
          try { recorder.stop() } catch (e) {}
        }
        recorder = null
        chunks = []
        stopTracks()
        resetDownload()
        shell.classList.remove('is-open')
        shell.setAttribute('aria-hidden', 'true')
        document.body.style.overflow = ''
        setStatus('')
        startBtn.hidden = false
        stopBtn.hidden = true
      }

      function beginRecording() {
        if (!stream) {
          flash('La cámara aún no está lista')
          return
        }
        const mimeType = pickMimeType()
        chunks = []
        try {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream)
        } catch (err) {
          flash('Este navegador no puede grabar vídeo')
          return
        }

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data)
        }
        recorder.onstop = async () => {
          stopPromptScroll()
          shell.classList.remove('is-recording')
          const type = (recorder && recorder.mimeType) || mimeType || 'video/webm'
          const blob = new Blob(chunks, { type })
          const ext = type.includes('mp4') ? 'mp4' : 'webm'
          const fileName = ${fileBase} + ext
          presentRecording(blob, type, fileName)
          startBtn.hidden = false
          stopBtn.hidden = true
          const saved = await saveLastRecording(blob, type, fileName)
          setStatus(saved
            ? 'Vídeo guardado aquí. Descárgalo para liberarlo.'
            : 'Vídeo listo en esta sesión. Descárgalo ahora.')
          flash(saved ? 'Vídeo guardado' : 'Vídeo listo')
        }

        recorder.start(250)
        startBtn.hidden = true
        stopBtn.hidden = false
        shell.classList.add('is-recording')
        setMenuOpen(false)
        setStatus('Grabando')
        startPromptScroll(true)
      }

      async function startWithCountdown() {
        if (starting || !stream) return
        if (recorder && recorder.state === 'recording') return
        starting = true
        await clearLastRecording()
        resetDownload()
        stopPromptScroll()
        setMenuOpen(false)
        let n = 3
        countdownEl.hidden = false
        countdownEl.textContent = String(n)
        setStatus('Cuenta regresiva')
        clearInterval(countdownTimer)
        countdownTimer = setInterval(() => {
          n -= 1
          if (n > 0) {
            countdownEl.textContent = String(n)
            return
          }
          clearCountdown()
          starting = false
          beginRecording()
        }, 1000)
      }

      openBtn.addEventListener('click', () => { openRecorder() })
      startBtn.addEventListener('click', () => { startWithCountdown() })
      stopBtn.addEventListener('click', () => {
        clearCountdown()
        starting = false
        stopPromptScroll()
        shell.classList.remove('is-recording')
        if (recorder && recorder.state === 'recording') recorder.stop()
        setStatus('Procesando')
      })
      closeBtn.addEventListener('click', () => { closeRecorder() })
      downloadBtn.addEventListener('click', () => {
        flash('Descarga en tu dispositivo')
        clearLastRecording().then(() => {
          setStatus('Descargado. La copia del navegador se eliminó.')
        })
      })
      slowerBtn.addEventListener('click', () => { changeSpeed(-1) })
      fasterBtn.addEventListener('click', () => { changeSpeed(1) })
      menuBtn.addEventListener('click', () => {
        setMenuOpen(menuEl.hidden)
      })
      modeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          applyMode(btn.getAttribute('data-mode'))
          setMenuOpen(false)
        })
      })
      bindNextDrag()
      window.addEventListener('resize', () => {
        if (!shell.classList.contains('is-open')) return
        const rect = nextBtn.getBoundingClientRect()
        placeNextBtn(rect.left, rect.top, true)
      })
    })()
`
}

function recorderStyles() {
  return `
    .recorder {
      position: fixed;
      inset: 0;
      z-index: 30;
      background: rgba(12, 12, 12, .72);
      display: none;
      align-items: stretch;
      justify-content: center;
      padding: 0;
    }
    .recorder.is-open { display: flex; }
    .recorder [hidden] { display: none !important; }
    .recorder__panel {
      position: relative;
      width: 100%;
      height: 100dvh;
      max-height: 100dvh;
      background: #0f0f10;
      color: #f5f5f5;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .recorder__head {
      position: relative;
      z-index: 8;
      padding: .7rem .85rem .55rem;
      background: rgba(15, 15, 16, .92);
      border-bottom: 1px solid rgba(255,255,255,.08);
      flex: 0 0 auto;
    }
    .recorder__title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .75rem;
    }
    .recorder__head-actions {
      display: flex;
      align-items: center;
      gap: .4rem;
    }
    .recorder__head h2 { margin: 0; font-size: 1.02rem; color: #fff; }
    .recorder__icon-btn,
    .recorder__menu-btn {
      background: rgba(255,255,255,.08);
      border-color: rgba(255,255,255,.16);
      color: #fff;
      padding: .42rem .72rem;
      font-size: .84rem;
      min-width: 2.6rem;
    }
    .recorder__menu-btn {
      width: 2.7rem;
      height: 2.7rem;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      line-height: 1;
      border-radius: 999px;
    }
    .recorder__menu {
      margin-top: .65rem;
      padding: .75rem;
      border-radius: 14px;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1);
    }
    .recorder__menu .muted {
      color: rgba(245,245,245,.72);
      margin: 0 0 .7rem;
      font-size: .84rem;
    }
    .recorder__menu-label {
      margin: 0 0 .4rem;
      font-size: .72rem;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: rgba(245,245,245,.55);
      font-weight: 700;
    }
    .recorder__modes {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: .35rem;
      margin-bottom: .75rem;
    }
    .recorder__mode {
      appearance: none;
      border: 0;
      background: rgba(255,255,255,.06);
      color: rgba(245,245,245,.86);
      font: inherit;
      font-size: .78rem;
      font-weight: 700;
      padding: .55rem .4rem;
      border-radius: 999px;
      cursor: pointer;
    }
    .recorder__mode.is-active {
      background: #fff;
      color: #151515;
    }
    .recorder__speed-row {
      display: grid;
      grid-template-columns: 2.6rem 1fr 2.6rem;
      gap: .4rem;
      align-items: center;
    }
    .recorder__tool {
      background: rgba(255,255,255,.1);
      border-color: rgba(255,255,255,.18);
      color: #fff;
      min-width: 2.6rem;
      height: 2.6rem;
      padding: 0;
      font-size: 1.25rem;
      font-weight: 700;
      border-radius: 999px;
      line-height: 1;
    }
    .recorder__tool:disabled {
      opacity: .35;
      cursor: default;
    }
    .recorder__speed {
      text-align: center;
      font-size: .9rem;
      font-weight: 700;
      color: #fff;
    }
    .recorder__viewport {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .recorder__stage {
      position: relative;
      background: #000;
      overflow: hidden;
    }
    .recorder__preview {
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center;
      display: block;
      transform: scaleX(-1);
      background: #000;
    }
    .recorder__veil {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: rgba(0,0,0,.18);
      transition: background .2s ease;
    }
    .recorder__countdown {
      position: absolute;
      inset: 0;
      z-index: 4;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: clamp(3.5rem, 18vw, 6rem);
      font-weight: 800;
      color: #fff;
      background: rgba(0,0,0,.35);
      pointer-events: none;
    }
    .recorder__status {
      position: absolute;
      left: 12px;
      bottom: 10px;
      z-index: 4;
      margin: 0;
      color: #fff;
      background: rgba(0,0,0,.5);
      padding: .35rem .65rem;
      border-radius: 999px;
      font-size: .82rem;
      font-weight: 700;
    }
    .recorder__script {
      position: relative;
      z-index: 3;
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      -webkit-overflow-scrolling: touch;
      padding: 1.1rem 1.15rem 7.5rem;
      font-size: clamp(1.35rem, 5.4vw, 1.9rem);
      line-height: 1.45;
      color: rgba(255,255,255,.55);
      scroll-behavior: smooth;
    }
    .recorder__line {
      margin: 0 0 .75rem;
      padding: .35rem .45rem;
      border-radius: 10px;
      transition: color .2s ease, opacity .2s ease, background .2s ease, transform .2s ease;
    }
    .recorder__break { height: .55rem; }
    .recorder__line.is-past { color: rgba(255,255,255,.28); }
    .recorder__line.is-active {
      color: #fff;
      background: rgba(71, 164, 231, .28);
      transform: scale(1.015);
      text-shadow: 0 1px 12px rgba(0,0,0,.45);
    }
    .recorder__next {
      position: fixed;
      z-index: 12;
      min-width: 8.2rem;
      min-height: 3.8rem;
      padding: 1rem 1.35rem;
      border: 0;
      border-radius: 999px;
      background: ${THEME_COLOR};
      color: #fff;
      font: inherit;
      font-size: 1.15rem;
      font-weight: 800;
      box-shadow: 0 10px 28px rgba(0,0,0,.35);
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .recorder__next.is-dragging {
      cursor: grabbing;
      opacity: .92;
      transform: scale(1.04);
    }
    .recorder__dock {
      position: absolute;
      right: 14px;
      bottom: calc(14px + env(safe-area-inset-bottom, 0px));
      z-index: 11;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: .55rem;
    }
    .recorder__rec {
      min-width: 7.4rem;
      min-height: 3.2rem;
      border-radius: 999px;
      border: 0;
      background: #e11d48;
      color: #fff;
      font: inherit;
      font-size: 1rem;
      font-weight: 800;
      box-shadow: 0 10px 24px rgba(225, 29, 72, .35);
      padding: .8rem 1.15rem;
    }
    .recorder__rec:hover,
    .recorder__rec:focus-visible {
      background: #be123c;
    }
    .recorder__download {
      background: rgba(255,255,255,.12);
      border: 1px solid rgba(255,255,255,.18);
      color: #fff;
      border-radius: 999px;
      padding: .65rem 1rem;
      font-weight: 700;
      text-decoration: none;
    }

    .recorder[data-mode="teleprompter"] .recorder__viewport { display: block; }
    .recorder[data-mode="teleprompter"] .recorder__stage {
      position: absolute;
      inset: 0;
      z-index: 1;
    }
    .recorder[data-mode="teleprompter"] .recorder__preview {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .recorder[data-mode="teleprompter"] .recorder__veil {
      background: rgba(8, 8, 10, .62);
    }
    .recorder[data-mode="teleprompter"].is-recording .recorder__veil {
      background: linear-gradient(180deg, rgba(8,8,10,.72) 0%, rgba(8,8,10,.48) 45%, rgba(8,8,10,.78) 100%);
    }
    .recorder[data-mode="teleprompter"] .recorder__script {
      position: absolute;
      inset: 0;
      z-index: 3;
      padding-top: 1.2rem;
      padding-bottom: 7.5rem;
      background: transparent;
    }

    .recorder[data-mode="pip"] .recorder__viewport {
      display: block;
      background: #121214;
    }
    .recorder[data-mode="pip"] .recorder__stage {
      position: absolute;
      right: 12px;
      bottom: 96px;
      z-index: 4;
      width: min(34vw, 150px);
      aspect-ratio: 9 / 16;
      max-height: 34vh;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.22);
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      overflow: hidden;
    }
    .recorder[data-mode="pip"][data-orientation="horizontal"] .recorder__stage {
      aspect-ratio: 16 / 9;
      width: min(42vw, 180px);
    }
    .recorder[data-mode="pip"] .recorder__veil { display: none; }
    .recorder[data-mode="pip"] .recorder__script {
      position: absolute;
      inset: 0;
      z-index: 2;
      padding: 1.1rem 1.15rem 7.5rem;
      background: #121214;
      color: rgba(255,255,255,.58);
    }
    .recorder[data-mode="pip"] .recorder__status {
      left: 8px;
      bottom: 8px;
      font-size: .68rem;
      padding: .25rem .45rem;
    }

    .recorder[data-mode="split"] .recorder__viewport {
      display: flex;
      flex-direction: column;
      background: #121214;
    }
    .recorder[data-mode="split"] .recorder__script {
      order: 1;
      flex: 1 1 62%;
      background: #121214;
      padding: .85rem 1.05rem 1.2rem;
    }
    .recorder[data-mode="split"] .recorder__stage {
      order: 2;
      flex: 0 0 30%;
      min-height: 22vh;
      max-height: 32vh;
      border-top: 1px solid rgba(255,255,255,.08);
      margin-bottom: 4.8rem;
    }
    .recorder[data-mode="split"] .recorder__veil { display: none; }
    .recorder[data-mode="split"] .recorder__preview {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .recorder[data-mode="nearcam"] .recorder__viewport {
      display: flex;
      flex-direction: column;
      background: #101012;
    }
    .recorder[data-mode="nearcam"] .recorder__script {
      order: 1;
      flex: 1 1 78%;
      padding: .55rem 1rem 1rem;
      font-size: clamp(1.45rem, 5.8vw, 2rem);
      background: #101012;
    }
    .recorder[data-mode="nearcam"] .recorder__stage {
      order: 2;
      flex: 0 0 16%;
      min-height: 14vh;
      max-height: 20vh;
      border-top: 1px solid rgba(255,255,255,.1);
      margin-bottom: 4.8rem;
    }
    .recorder[data-mode="nearcam"] .recorder__veil { display: none; }
    .recorder[data-mode="nearcam"] .recorder__preview {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .recorder[data-mode="nearcam"] .recorder__status {
      left: 8px;
      bottom: 8px;
      font-size: .7rem;
    }

    @media (min-width: 860px) {
      .recorder { padding: 18px; align-items: center; }
      .recorder__panel {
        width: min(820px, 100%);
        height: min(920px, 100dvh);
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,.1);
      }
      .recorder[data-mode="pip"] .recorder__stage { width: 160px; }
      .recorder[data-mode="pip"][data-orientation="horizontal"] .recorder__stage { width: 220px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .recorder__script { scroll-behavior: auto; }
      .recorder__line, .recorder__veil, .recorder__next { transition: none; }
    }
`
}

function packPageStyles(hasVideo) {
  return `
    :root {
      --bg: #f6f4f1;
      --card: #fff;
      --ink: #303030;
      --muted: #6b6b6b;
      --line: rgba(48,48,48,.12);
      --accent: ${THEME_COLOR};
      --accent-ink: #fff;
      --warn-bg: #fff6e8;
      --warn-ink: #8a5a12;
      --feature: #eef6fc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    .wrap { max-width: 920px; margin: 0 auto; padding: 28px 18px 64px; }
    .top { margin-bottom: 1.5rem; }
    .eyebrow { font-size: .75rem; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin: 0 0 .5rem; }
    h1 { font-size: 1.55rem; line-height: 1.25; margin: 0 0 .75rem; }
    .meta { color: var(--muted); font-size: .95rem; margin: 0 0 1rem; }
    .meta a { color: var(--accent); font-weight: 700; }
    .grid { display: grid; gap: 1rem; }
    @media (min-width: 860px) {
      .layout { display: grid; grid-template-columns: 1.2fr .8fr; gap: 1.25rem; align-items: start; }
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 1.1rem 1.15rem 1.2rem;
      margin-bottom: 1rem;
    }
    .card--featured {
      background: linear-gradient(180deg, var(--feature) 0%, var(--card) 48%);
      border-color: rgba(71,164,231,.35);
      box-shadow: 0 8px 24px rgba(71,164,231,.08);
    }
    .card__head h2 { margin: 0 0 .25rem; font-size: 1.15rem; }
    .card__title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .75rem;
      flex-wrap: wrap;
    }
    .card__title-row h2 { margin: 0; }
    .muted { color: var(--muted); margin: 0; font-size: .9rem; }
    .field-label { display: block; font-size: .8rem; font-weight: 700; margin: .85rem 0 .35rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .preview {
      margin-top: .75rem;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fafafa;
      padding: .85rem .95rem;
    }
    .preview--script { background: #fff; }
    .preview-text {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font: inherit;
      line-height: 1.55;
      color: var(--ink);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .preview-text--script {
      font-size: 1.05rem;
      line-height: 1.65;
    }
    .preview.is-open .preview-text {
      display: block;
      overflow: visible;
      -webkit-line-clamp: unset;
    }
    .preview-more {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--accent);
      font: inherit;
      font-weight: 700;
      font-size: .88rem;
      padding: .45rem 0 0;
      cursor: pointer;
    }
    .notice {
      margin: .85rem 0 0;
      padding: .7rem .85rem;
      border-radius: 10px;
      background: var(--warn-bg);
      color: var(--warn-ink);
      font-size: .88rem;
      font-weight: 600;
      line-height: 1.4;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: .28rem .6rem;
      border-radius: 999px;
      background: ${THEME_COLOR};
      color: #fff;
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
    .actions--script { align-items: center; }
    .actions--script .btn--record { margin-left: auto; }
    .btn {
      appearance: none;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-weight: 700;
      font-size: .9rem;
      padding: .55rem .9rem;
      border-radius: 999px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn--primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    .btn--ghost { background: transparent; }
    .btn--record {
      background: #e11d48;
      border-color: #e11d48;
      color: #fff;
    }
    .btn--record:hover,
    .btn--record:focus-visible {
      background: #be123c;
      border-color: #be123c;
    }
    .btn.is-ok { background: #1f7a4d; border-color: #1f7a4d; color: #fff; }
    .media img {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #eee;
    }
    .nav { margin-bottom: 1.25rem; }
    .nav a { color: var(--accent); font-weight: 700; text-decoration: none; }
    .toast {
      position: fixed; bottom: 18px; right: 18px;
      background: #1f7a4d; color: #fff; padding: .65rem 1rem;
      border-radius: 999px; font-weight: 700; font-size: .9rem;
      opacity: 0; pointer-events: none; transition: opacity .2s ease;
      z-index: 40;
    }
    .toast.show { opacity: 1; }
    #video-canonical-json { display: none; }
${hasVideo ? recorderStyles() : ''}
`
}

function packPageClientJs(slug, hasVideo) {
  return `
${hasVideo ? packClientHelpersJs(slug) : ''}
${igCarouselClientJs()}
    const toast = document.getElementById('toast')
    function flash(msg) {
      toast.textContent = msg || 'Copiado'
      toast.classList.add('show')
      setTimeout(() => toast.classList.remove('show'), 1400)
    }

    function applyClamp(preview) {
      const textEl = preview.querySelector('.preview-text')
      const btn = preview.querySelector('[data-toggle-preview]')
      if (!textEl || !btn) return
      const lines = Number(preview.getAttribute('data-lines') || 6)
      textEl.style.webkitLineClamp = String(lines)
      preview.classList.remove('is-open')
      btn.hidden = true
      btn.textContent = 'Leer más'
      requestAnimationFrame(() => {
        const overflowing = textEl.scrollHeight > textEl.clientHeight + 2
        btn.hidden = !overflowing
      })
    }

    function initPreviews() {
      document.querySelectorAll('[data-preview]').forEach((preview) => {
        applyClamp(preview)
        const btn = preview.querySelector('[data-toggle-preview]')
        if (!btn || btn.dataset.bound) return
        btn.dataset.bound = '1'
        btn.addEventListener('click', () => {
          const open = preview.classList.toggle('is-open')
          btn.textContent = open ? 'Leer menos' : 'Leer más'
        })
      })
    }

    function textFromTarget(id) {
      const el = document.getElementById(id)
      if (!el) return ''
      if (id === 'video-body' && typeof getLiveScript === 'function') return getLiveScript()
      return String(el.textContent || '')
    }

    function syncVideoPreview() {
      const body = document.getElementById('video-body')
      if (!body || typeof getLiveScript !== 'function') return
      const live = getLiveScript()
      body.textContent = live
      const edited = hasScriptOverride()
      const badge = document.getElementById('video-edited-badge')
      const notice = document.getElementById('video-ephemeral-notice')
      const restore = document.getElementById('btn-restore-script')
      if (badge) badge.hidden = !edited
      if (notice) notice.hidden = !edited
      if (restore) restore.hidden = !edited
      const preview = body.closest('[data-preview]')
      if (preview) applyClamp(preview)
    }

    document.querySelectorAll('[data-copy-text]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-copy-text')
        const text = textFromTarget(id)
        try {
          await navigator.clipboard.writeText(text)
          btn.classList.add('is-ok')
          const prev = btn.textContent
          btn.textContent = 'Copiado'
          flash('Copiado')
          setTimeout(() => {
            btn.classList.remove('is-ok')
            btn.textContent = prev
          }, 1200)
        } catch (e) {
          flash('No se pudo copiar')
        }
      })
    })

    const restoreBtn = document.getElementById('btn-restore-script')
    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        clearStoredScript()
        syncVideoPreview()
        flash('Guion original restaurado')
      })
    }

    syncVideoPreview()
    initPreviews()
    initIgCarousel()
${hasVideo ? recorderScript(slug) : ''}
`
}

function igCarouselClientJs() {
  return `
    function initIgCarousel() {
      const root = document.querySelector('[data-ig-carousel]')
      if (!root) return
      const dataEl = document.getElementById('ig-slides-data')
      if (!dataEl) return
      let slides = []
      try { slides = JSON.parse(dataEl.textContent || '[]') } catch (e) { slides = [] }
      if (!slides.length) return

      let index = 0
      const photo = root.querySelector('[data-ig-photo]')
      const counter = root.querySelector('[data-ig-counter]')
      const headline = root.querySelector('[data-ig-headline]')
      const body = root.querySelector('[data-ig-body]')
      const altEl = document.getElementById('ig-alt-current')
      const openBtn = root.querySelector('[data-ig-open]')
      const downloadOne = root.querySelector('[data-ig-download-one]')
      const prevBtn = root.querySelector('[data-ig-prev]')
      const nextBtn = root.querySelector('[data-ig-next]')
      const dotsWrap = root.querySelector('[data-ig-dots]')
      const viewport = root.querySelector('.ig-viewport')

      function render() {
        const slide = slides[index]
        if (!slide) return
        if (photo) {
          photo.src = slide.src || ''
          photo.alt = slide.alt || ('Slide ' + slide.n)
        }
        if (counter) counter.textContent = (index + 1) + ' / ' + slides.length
        if (headline) headline.textContent = slide.headline || ''
        if (body) body.textContent = slide.body || ''
        if (altEl) altEl.textContent = slide.alt || ''
        if (openBtn) openBtn.href = slide.src || '#'
        if (downloadOne) {
          downloadOne.href = slide.download || slide.src || '#'
          downloadOne.setAttribute('download', slide.name || ('ig-slide-' + String(slide.n).padStart(2, '0') + '.webp'))
        }
        if (prevBtn) prevBtn.disabled = index === 0
        if (nextBtn) nextBtn.disabled = index === slides.length - 1
        if (dotsWrap) {
          dotsWrap.querySelectorAll('[data-ig-dot]').forEach((dot) => {
            const i = Number(dot.getAttribute('data-ig-dot'))
            dot.classList.toggle('is-active', i === index)
          })
        }
        const preview = altEl ? altEl.closest('[data-preview]') : null
        if (preview) applyClamp(preview)
      }

      function go(next) {
        index = Math.max(0, Math.min(slides.length - 1, next))
        render()
      }

      if (prevBtn) prevBtn.addEventListener('click', () => go(index - 1))
      if (nextBtn) nextBtn.addEventListener('click', () => go(index + 1))
      if (dotsWrap) {
        dotsWrap.querySelectorAll('[data-ig-dot]').forEach((dot) => {
          dot.addEventListener('click', () => go(Number(dot.getAttribute('data-ig-dot'))))
        })
      }

      let touchX = null
      if (viewport) {
        viewport.addEventListener('touchstart', (e) => {
          touchX = e.changedTouches?.[0]?.clientX ?? null
        }, { passive: true })
        viewport.addEventListener('touchend', (e) => {
          if (touchX == null) return
          const endX = e.changedTouches?.[0]?.clientX ?? touchX
          const delta = endX - touchX
          touchX = null
          if (Math.abs(delta) < 40) return
          go(delta < 0 ? index + 1 : index - 1)
        }, { passive: true })
      }

      async function downloadBlob(url, name) {
        const res = await fetch(url, { mode: 'cors' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = name || 'slide.webp'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
      }

      const downloadAllBtn = root.querySelector('[data-ig-download-all]')
      if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', async () => {
          downloadAllBtn.disabled = true
          const prev = downloadAllBtn.textContent
          downloadAllBtn.textContent = 'Descargando…'
          let ok = 0
          for (const slide of slides) {
            try {
              await downloadBlob(slide.download || slide.src, slide.name)
              ok += 1
              await new Promise((r) => setTimeout(r, 280))
            } catch (e) {
              const a = document.createElement('a')
              a.href = slide.download || slide.src
              a.download = slide.name || 'slide.webp'
              a.target = '_blank'
              a.rel = 'noopener'
              document.body.appendChild(a)
              a.click()
              a.remove()
              await new Promise((r) => setTimeout(r, 280))
            }
          }
          flash(ok ? ('Descargadas ' + ok + ' imágenes') : 'Revisa las descargas del navegador')
          downloadAllBtn.disabled = false
          downloadAllBtn.textContent = prev
        })
      }

      render()
    }
`
}

function instagramSection(pack, slidesResolved) {
  if (!PACK_CHANNELS.instagramCarousel) return ''
  const slides = slidesResolved?.length ? slidesResolved : pack.instagramSlides || []
  if (!slides.length && !pack.instagramCaption) return ''

  const slidesJson = JSON.stringify(
    slides.map((slide, index) => ({
      n: index + 1,
      src: slide.previewSrc || slide.imageUrl || '',
      download: slide.downloadHref || slide.imageUrl || '',
      name: slide.downloadName || `ig-slide-${String(index + 1).padStart(2, '0')}.webp`,
      alt: slide.alt || `Slide ${index + 1}`,
      headline: slide.headline || '',
      body: slide.body || ''
    }))
  )

  const dots = slides
    .map(
      (_, index) =>
        `<button type="button" class="ig-dot${index === 0 ? ' is-active' : ''}" data-ig-dot="${index}" aria-label="Ir a slide ${index + 1}"></button>`
    )
    .join('')

  const captionBlock = pack.instagramCaption
    ? `<p class="field-label">Caption</p>
  <div class="preview" data-preview data-lines="5">
    <div class="preview-text" id="instagram-caption">${escapeHtml(pack.instagramCaption)}</div>
    <button type="button" class="preview-more" data-toggle-preview hidden>Leer más</button>
  </div>
  <div class="actions">
    <button type="button" class="btn btn--primary" data-copy-text="instagram-caption">Copiar caption</button>
  </div>`
    : ''

  const carousel = slides.length
    ? `<div class="ig-carousel" data-ig-carousel>
  <script type="application/json" id="ig-slides-data">${slidesJson.replace(/</g, '\\u003c')}</script>
  <div class="ig-frame" aria-roledescription="carrusel">
    <button type="button" class="ig-nav ig-nav--prev" data-ig-prev aria-label="Slide anterior">‹</button>
    <div class="ig-viewport">
      <img class="ig-photo" data-ig-photo src="${escapeHtml(slides[0].previewSrc || slides[0].imageUrl || '')}" alt="${escapeHtml(slides[0].alt || 'Slide 1')}" width="1080" height="1350">
      <p class="ig-counter" data-ig-counter>1 / ${slides.length}</p>
    </div>
    <button type="button" class="ig-nav ig-nav--next" data-ig-next aria-label="Slide siguiente">›</button>
  </div>
  <div class="ig-dots" data-ig-dots>${dots}</div>
  <p class="slide-headline" data-ig-headline>${escapeHtml(slides[0].headline || '')}</p>
  <p class="muted slide-body" data-ig-body>${escapeHtml(slides[0].body || '')}</p>
  <p class="field-label">Alt del slide actual</p>
  <div class="preview" data-preview data-lines="3">
    <div class="preview-text" id="ig-alt-current">${escapeHtml(slides[0].alt || '')}</div>
    <button type="button" class="preview-more" data-toggle-preview hidden>Leer más</button>
  </div>
  <div class="actions">
    <button type="button" class="btn" data-copy-text="ig-alt-current">Copiar alt</button>
    <a class="btn" data-ig-open href="${escapeHtml(slides[0].previewSrc || slides[0].imageUrl || '')}" target="_blank" rel="noopener noreferrer">Abrir slide</a>
    <a class="btn btn--primary" data-ig-download-one href="${escapeHtml(slides[0].downloadHref || slides[0].imageUrl || '')}" download="${escapeHtml(slides[0].downloadName || 'ig-slide-01.webp')}">Descargar slide</a>
  </div>
  <div class="actions" style="margin-top:.35rem">
    <button type="button" class="btn btn--primary" data-ig-download-all>Descargar todo el carrusel</button>
  </div>
</div>`
    : '<p class="muted">Aún no hay slides en socialPack.instagramSlides.</p>'

  return `<section class="card" id="instagram">
  <header class="card__head">
    <h2>Instagram · carrusel</h2>
    <p class="muted">Vista tipo Instagram. Desliza, copia el alt del slide activo y descarga las imágenes.</p>
  </header>
  ${captionBlock}
  ${carousel}
</section>`
}

function packPageHtml({ post, pack, articleUrl, imageSrc, downloadHref, downloadName, slidesResolved }) {
  const channels = []
  if (PACK_CHANNELS.substack && (pack.substackBody || pack.substackTitle)) {
    channels.push({
      id: 'substack',
      label: 'Substack',
      hint: 'Título + cuerpo del newsletter.',
      title: pack.substackTitle,
      body: pack.substackBody,
      lines: 6
    })
  }
  if (PACK_CHANNELS.linkedin && pack.linkedin) {
    channels.push({
      id: 'linkedin',
      label: 'LinkedIn',
      hint: 'Publicación nativa. Adjunta la imagen del pack.',
      title: null,
      body: pack.linkedin,
      lines: 6
    })
  }
  if (PACK_CHANNELS.x && pack.x) {
    channels.push({
      id: 'x',
      label: 'X',
      hint: `Límite práctico 280. Contaje con URL = ${xCharCount(pack.x)}`,
      title: null,
      body: pack.x,
      lines: 5
    })
  }

  const blocks = channels
    .map((ch) => {
      const titleBlock = ch.title
        ? `<p class="field-label">Título</p>
  <div class="preview" data-preview data-lines="2">
    <div class="preview-text" id="${ch.id}-title">${escapeHtml(ch.title)}</div>
    <button type="button" class="preview-more" data-toggle-preview hidden>Leer más</button>
  </div>
  <div class="actions" style="margin-top:.5rem">
    <button type="button" class="btn" data-copy-text="${ch.id}-title">Copiar título</button>
  </div>
  <p class="field-label">Texto</p>`
        : ''
      return `<section class="card" id="${ch.id}">
  <header class="card__head">
    <h2>${escapeHtml(ch.label)}</h2>
    <p class="muted">${escapeHtml(ch.hint)}</p>
  </header>
  ${titleBlock}
  <div class="preview" data-preview data-lines="${ch.lines}">
    <div class="preview-text" id="${ch.id}-body">${escapeHtml(ch.body)}</div>
    <button type="button" class="preview-more" data-toggle-preview hidden>Leer más</button>
  </div>
  <div class="actions">
    <button type="button" class="btn btn--primary" data-copy-text="${ch.id}-body">Copiar texto</button>
  </div>
</section>`
    })
    .join('\n')

  const videoBlock =
    PACK_CHANNELS.videoScript && pack.videoScript ? videoScriptSection(pack, post.slug) : ''
  const recorderBlock =
    PACK_CHANNELS.videoScript && pack.videoScript ? recorderMarkup(post.slug) : ''
  const hasVideo = Boolean(PACK_CHANNELS.videoScript && pack.videoScript)
  const igBlock = instagramSection(pack, slidesResolved)

  return `<!DOCTYPE html>
<html lang="es">
<head>
${adminPwaHead({
  title: `Pack redes · ${post.title} · Escarlet admin`,
  description: 'Pack de publicación del blog Escarlet para el equipo.'
})}
  <style>
${packPageStyles(hasVideo)}
    .ig-carousel { margin-top: 1rem; }
    .ig-frame {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: .55rem;
      align-items: center;
    }
    .ig-viewport {
      position: relative;
      border-radius: 18px;
      overflow: hidden;
      background: #111;
      aspect-ratio: 4 / 5;
      max-width: 420px;
      margin: 0 auto;
      width: 100%;
      touch-action: pan-y;
      user-select: none;
      box-shadow: 0 14px 40px rgba(0,0,0,.18);
    }
    .ig-photo {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      background: #222;
    }
    .ig-counter {
      position: absolute;
      top: .7rem;
      right: .7rem;
      margin: 0;
      padding: .25rem .55rem;
      border-radius: 999px;
      background: rgba(0,0,0,.55);
      color: #fff;
      font-size: .75rem;
      font-weight: 700;
    }
    .ig-nav {
      width: 2.4rem;
      height: 2.4rem;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
    }
    .ig-nav:disabled { opacity: .35; cursor: default; }
    .ig-dots {
      display: flex;
      justify-content: center;
      gap: .4rem;
      margin: .85rem 0 .65rem;
    }
    .ig-dot {
      width: .55rem;
      height: .55rem;
      border-radius: 999px;
      border: 0;
      padding: 0;
      background: rgba(48,48,48,.25);
      cursor: pointer;
    }
    .ig-dot.is-active { background: var(--accent); transform: scale(1.15); }
    .slide-headline {
      margin: 0 0 .35rem;
      font-weight: 800;
      font-size: .95rem;
      min-height: 1.2em;
    }
    .slide-body { margin: 0 0 .65rem; font-size: .88rem; min-height: 1.2em; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="nav"><a href="/admin/blog-packs">← Todos los packs</a></p>
    <header class="top">
      <p class="eyebrow">Pack de publicación · solo equipo</p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="meta">
        ${escapeHtml(post.authorName || 'Escarlet')} · ${escapeHtml(post.datePublished || '')}<br>
        Artículo · <a href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(articleUrl)}</a>
      </p>
    </header>

    <div class="layout">
      <div class="grid">
        ${videoBlock ? `${videoBlock}\n        ` : ''}${blocks}${igBlock ? `\n        ${igBlock}` : ''}
      </div>
      <aside class="card media">
        <h2>Imagen</h2>
        <p class="muted">Descarga y súbela en Substack, LinkedIn o X.</p>
        <p class="field-label">Vista previa</p>
        <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(post.imageAlt || post.title)}" width="1200" height="630">
        <div class="actions">
          <a class="btn btn--primary" href="${escapeHtml(downloadHref)}" download="${escapeHtml(downloadName)}">Descargar imagen</a>
          <a class="btn" href="${escapeHtml(imageSrc)}" target="_blank" rel="noopener noreferrer">Abrir</a>
        </div>
        <p class="field-label">Alt sugerido</p>
        <div class="preview" data-preview data-lines="3">
          <div class="preview-text" id="image-alt">${escapeHtml(post.imageAlt || '')}</div>
          <button type="button" class="preview-more" data-toggle-preview hidden>Leer más</button>
        </div>
        <div class="actions">
          <button type="button" class="btn" data-copy-text="image-alt">Copiar alt</button>
        </div>
      </aside>
    </div>
  </div>
  ${recorderBlock ? `${recorderBlock}\n  ` : ''}<div class="toast" id="toast" role="status">Copiado</div>
  <script>
${packPageClientJs(post.slug, hasVideo)}
  </script>
</body>
</html>
`
}

function editPageHtml({ post, pack, articleUrl }) {
  const canonical = pack.videoScript || ''
  return `<!DOCTYPE html>
<html lang="es">
<head>
${adminPwaHead({
  title: `Editar guion · ${post.title} · Escarlet admin`,
  description: 'Editor temporal del guion de vídeo para el pack del blog.'
})}
  <style>
    :root {
      --bg: #f6f4f1;
      --card: #fff;
      --ink: #303030;
      --muted: #6b6b6b;
      --line: rgba(48,48,48,.12);
      --accent: ${THEME_COLOR};
      --accent-ink: #fff;
      --warn-bg: #fff6e8;
      --warn-ink: #8a5a12;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
      min-height: 100dvh;
    }
    .wrap { max-width: 760px; margin: 0 auto; padding: 24px 18px 48px; }
    .nav { margin-bottom: 1rem; }
    .nav a { color: var(--accent); font-weight: 700; text-decoration: none; }
    .eyebrow { font-size: .75rem; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin: 0 0 .45rem; }
    h1 { font-size: 1.45rem; line-height: 1.25; margin: 0 0 .5rem; }
    .meta { color: var(--muted); margin: 0 0 1rem; font-size: .92rem; }
    .meta a { color: var(--accent); font-weight: 700; }
    .notice {
      margin: 0 0 1rem;
      padding: .85rem 1rem;
      border-radius: 12px;
      background: var(--warn-bg);
      color: var(--warn-ink);
      font-size: .92rem;
      font-weight: 600;
      line-height: 1.45;
    }
    .editor-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 1rem 1.05rem 1.15rem;
      display: flex;
      flex-direction: column;
      gap: .75rem;
      min-height: min(70dvh, 640px);
    }
    label {
      font-size: .78rem;
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: var(--muted);
    }
    #script-editor {
      width: 100%;
      flex: 1 1 auto;
      min-height: 22rem;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 1rem 1.05rem;
      font: inherit;
      font-size: 1.12rem;
      line-height: 1.7;
      resize: vertical;
      background: #fafafa;
      color: var(--ink);
    }
    #script-editor:focus {
      outline: 2px solid rgba(71,164,231,.45);
      outline-offset: 1px;
      background: #fff;
    }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: .5rem 1rem;
      color: var(--muted);
      font-size: .9rem;
      font-weight: 600;
    }
    .stats strong { color: var(--ink); }
    .stats .is-warn { color: #b45309; }
    .actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .btn {
      appearance: none;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-weight: 700;
      font-size: .92rem;
      padding: .6rem 1rem;
      border-radius: 999px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn--primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    .btn--ghost { background: transparent; }
    .toast {
      position: fixed; bottom: 18px; right: 18px;
      background: #1f7a4d; color: #fff; padding: .65rem 1rem;
      border-radius: 999px; font-weight: 700; font-size: .9rem;
      opacity: 0; pointer-events: none; transition: opacity .2s ease;
      z-index: 40;
    }
    .toast.show { opacity: 1; }
    #video-canonical-json { display: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="nav"><a href="/admin/blog-packs/${escapeHtml(post.slug)}#video">← Volver al pack</a></p>
    <p class="eyebrow">Editor temporal · solo este dispositivo</p>
    <h1>Editar guion</h1>
    <p class="meta">${escapeHtml(post.title)}<br>
      <a href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">Ver artículo</a>
    </p>
    <p class="notice">
      Este cambio queda solo en este dispositivo y se pierde si borras datos del navegador o restauras el original. No se guarda en el post del blog.
    </p>
    <script type="application/json" id="video-canonical-json">${JSON.stringify(canonical)}</script>
    <div class="editor-card">
      <label for="script-editor">Guion oral</label>
      <textarea id="script-editor" spellcheck="true"></textarea>
      <div class="stats" aria-live="polite">
        <span><strong id="word-count">0</strong> palabras</span>
        <span id="word-guide">Guía habitual 100–140</span>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--primary" id="btn-save">Guardar en este dispositivo</button>
        <a class="btn" href="/admin/blog-packs/${escapeHtml(post.slug)}#video">Descartar</a>
        <button type="button" class="btn btn--ghost" id="btn-restore">Restaurar original</button>
      </div>
    </div>
  </div>
  <div class="toast" id="toast" role="status">Guardado</div>
  <script>
${packClientHelpersJs(post.slug)}
    const editor = document.getElementById('script-editor')
    const wordEl = document.getElementById('word-count')
    const guideEl = document.getElementById('word-guide')
    const toast = document.getElementById('toast')
    const packUrl = ${JSON.stringify(`/admin/blog-packs/${post.slug}#video`)}

    function flash(msg) {
      toast.textContent = msg || 'Guardado'
      toast.classList.add('show')
      setTimeout(() => toast.classList.remove('show'), 1400)
    }

    function refreshStats() {
      const n = wordCount(editor.value)
      wordEl.textContent = String(n)
      const out = n > 0 && (n < 80 || n > 160)
      guideEl.classList.toggle('is-warn', out)
      guideEl.textContent = out
        ? 'Fuera de la guía habitual (100–140)'
        : 'Guía habitual 100–140'
    }

    editor.value = getLiveScript()
    refreshStats()
    editor.addEventListener('input', refreshStats)
    editor.focus()

    document.getElementById('btn-save').addEventListener('click', () => {
      const text = editor.value
      if (!writeStoredScript(text)) {
        flash('No se pudo guardar')
        return
      }
      flash('Guardado en este dispositivo')
      setTimeout(() => { window.location.href = packUrl }, 450)
    })

    document.getElementById('btn-restore').addEventListener('click', () => {
      clearStoredScript()
      editor.value = getCanonicalScript()
      refreshStats()
      flash('Original restaurado')
    })
  </script>
</body>
</html>
`
}

function hasSocialPack(post) {
  const pack = post.socialPack || {}
  const slides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
  return Boolean(
    (PACK_CHANNELS.substack && (pack.substackBody || pack.substackTitle)) ||
      (PACK_CHANNELS.linkedin && pack.linkedin) ||
      (PACK_CHANNELS.x && pack.x) ||
      (PACK_CHANNELS.videoScript && pack.videoScript) ||
      (PACK_CHANNELS.instagramCarousel && (pack.instagramCaption || slides.length))
  )
}

function indexHtml(items) {
  const rows = items.length
    ? items
        .map((item) => {
          const chips = []
          if (item.hasSubstack) chips.push('Substack')
          if (item.hasX) chips.push('X')
          if (item.hasLinkedin) chips.push('LinkedIn')
          if (item.hasVideo) chips.push('Vídeo')
          if (item.hasInstagram) chips.push('Instagram')
          const chipHtml = chips.length
            ? `<div class="chips">${chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div>`
            : ''
          const videoLink = item.hasVideo
            ? `<a class="pack-link" href="/admin/blog-packs/${escapeHtml(item.slug)}#video">Guion</a>`
            : ''
          const igLink = item.hasInstagram
            ? `<a class="pack-link" href="/admin/blog-packs/${escapeHtml(item.slug)}#instagram">Carrusel</a>`
            : ''
          return `<li>
  <div class="pack-row">
    <div>
      <a class="pack-title" href="/admin/blog-packs/${escapeHtml(item.slug)}"><strong>${escapeHtml(item.title)}</strong></a>
      <p class="muted pack-meta">${escapeHtml(item.datePublished)} · ${escapeHtml(item.authorName || '')}</p>
      ${chipHtml}
    </div>
    <div class="pack-actions">
      <a class="pack-link" href="/admin/blog-packs/${escapeHtml(item.slug)}">Abrir</a>
      ${videoLink}
      ${igLink}
    </div>
  </div>
</li>`
        })
        .join('\n')
    : `<li class="muted">Aún no hay packs. Añade socialPack al post y ejecuta npm run blog:packs.</li>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
${adminPwaHead({
  title: 'Packs de redes · Blog Escarlet',
  description: 'Packs de publicación del blog Escarlet para Substack, X, LinkedIn, Instagram y vídeo.'
})}
  <style>
    :root {
      --bg: #f6f4f1;
      --card: #fff;
      --ink: #303030;
      --muted: #6b6b6b;
      --line: rgba(48,48,48,.12);
      --accent: ${THEME_COLOR};
    }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--ink); }
    .wrap { max-width: 760px; margin: 0 auto; padding: 28px 18px 64px; }
    h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
    .muted { color: var(--muted); }
    ul { list-style: none; padding: 0; margin: 1.5rem 0 0; }
    li {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 1rem 1.1rem;
      margin-bottom: .75rem;
    }
    .pack-row {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      justify-content: space-between;
    }
    .pack-title { color: var(--accent); text-decoration: none; font-size: 1.02rem; }
    .pack-meta { margin: .35rem 0 .55rem; font-size: .9rem; }
    .chips { display: flex; flex-wrap: wrap; gap: .35rem; }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: .22rem .55rem;
      border-radius: 999px;
      background: #eef6fc;
      color: #1f5f8a;
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    .pack-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: .35rem;
      flex: 0 0 auto;
    }
    .pack-link {
      color: var(--accent);
      text-decoration: none;
      font-weight: 700;
      font-size: .88rem;
    }
    @media (max-width: 560px) {
      .pack-row { flex-direction: column; }
      .pack-actions { flex-direction: row; align-items: center; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="muted" style="font-size:.75rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">Admin Escarlet</p>
    <h1>Packs de publicación del blog</h1>
    <p class="muted">Textos e imágenes listos para copiar o descargar. Publicación en redes manual.</p>
    <ul>
${rows}
    </ul>
  </div>
</body>
</html>
`
}

function resetOutRoot() {
  if (existsSync(outRoot)) {
    for (const name of readdirSync(outRoot)) {
      rmSync(join(outRoot, name), { recursive: true, force: true })
    }
  }
  mkdirSync(outRoot, { recursive: true })
}

async function downloadRemoteImage(url, destPath) {
  if (!url || !/^https?:\/\//i.test(url)) return false
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    writeFileSync(destPath, Buffer.from(await res.arrayBuffer()))
    return true
  } catch {
    return false
  }
}

resetOutRoot()

const posts = getAllBlogPosts().filter(hasSocialPack)
const indexItems = []

for (const post of posts) {
  const articleUrl = getPostCanonicalUrl(post.slug) || `${SITE}/blog/${post.slug}`
  const pack = normalizeSocialPack(post.socialPack, post.title)

  const img = resolveImagePaths(post.imageUrl)
  const packDir = join(outRoot, post.slug)
  mkdirSync(packDir, { recursive: true })

  let downloadHref = img.downloadRel.startsWith('http')
    ? img.downloadRel
    : img.downloadRel.startsWith('/')
      ? img.downloadRel
      : `/${String(img.downloadRel || '').replace(/^\.\//, '')}`
  let downloadName = basename(post.imageUrl || 'cover.webp')
  let imageSrc = img.webAbs || post.imageUrl

  const preferredLocal = img.localJpg || img.localWebp
  if (preferredLocal) {
    const destName = basename(preferredLocal)
    copyFileSync(preferredLocal, join(packDir, destName))
    downloadHref = `/admin/blog-packs/${post.slug}/${destName}`
    downloadName = destName
    imageSrc = downloadHref
  } else if (/^https?:\/\//i.test(post.imageUrl || '')) {
    const destName = basename((post.imageUrl || '').split('?')[0] || 'cover.webp') || 'cover.webp'
    const destPath = join(packDir, destName)
    if (await downloadRemoteImage(post.imageUrl, destPath)) {
      downloadHref = `/admin/blog-packs/${post.slug}/${destName}`
      downloadName = destName
      imageSrc = downloadHref
    }
  }

  const slidesResolved = []
  if (PACK_CHANNELS.instagramCarousel && pack.instagramSlides?.length) {
    for (let index = 0; index < pack.instagramSlides.length; index += 1) {
      const slide = pack.instagramSlides[index]
      const n = String(index + 1).padStart(2, '0')
      const resolved = resolveImagePaths(slide.imageUrl)
      let previewSrc = resolved.webAbs || slide.imageUrl
      let slideDownload = slide.imageUrl?.startsWith('http')
        ? slide.imageUrl
        : slide.imageUrl?.startsWith('/')
          ? slide.imageUrl
          : previewSrc
      let slideName = `ig-slide-${n}${extname(((slide.imageUrl || '').split('?')[0])) || '.webp'}`
      const local = resolved.localJpg || resolved.localWebp
      if (local) {
        slideName = `ig-slide-${n}${extname(local)}`
        copyFileSync(local, join(packDir, slideName))
        slideDownload = `/admin/blog-packs/${post.slug}/${slideName}`
        previewSrc = slideDownload
      } else if (/^https?:\/\//i.test(slide.imageUrl || '')) {
        const destPath = join(packDir, slideName)
        if (await downloadRemoteImage(slide.imageUrl, destPath)) {
          slideDownload = `/admin/blog-packs/${post.slug}/${slideName}`
          previewSrc = slideDownload
        }
      }
      slidesResolved.push({
        ...slide,
        previewSrc,
        downloadHref: slideDownload,
        downloadName: slideName
      })
    }
  }

  writeFileSync(
    join(packDir, 'index.html'),
    packPageHtml({
      post,
      pack,
      articleUrl,
      imageSrc,
      downloadHref,
      downloadName,
      slidesResolved
    }),
    'utf8'
  )

  if (PACK_CHANNELS.videoScript && pack.videoScript) {
    const editDir = join(packDir, 'edit')
    mkdirSync(editDir, { recursive: true })
    writeFileSync(
      join(editDir, 'index.html'),
      editPageHtml({ post, pack, articleUrl }),
      'utf8'
    )
  }

  indexItems.push({
    slug: post.slug,
    title: post.title,
    datePublished: post.datePublished,
    authorName: post.authorName,
    hasSubstack: Boolean(PACK_CHANNELS.substack && (pack.substackBody || pack.substackTitle)),
    hasX: Boolean(PACK_CHANNELS.x && pack.x),
    hasLinkedin: Boolean(PACK_CHANNELS.linkedin && pack.linkedin),
    hasVideo: Boolean(PACK_CHANNELS.videoScript && pack.videoScript),
    hasInstagram: Boolean(
      PACK_CHANNELS.instagramCarousel &&
        (pack.instagramCaption || pack.instagramSlides?.length)
    )
  })
}

writeFileSync(join(outRoot, 'index.html'), indexHtml(indexItems), 'utf8')
writeFileSync(join(outRoot, 'manifest.webmanifest'), adminManifestJson(), 'utf8')

console.log(`blog-social-packs: ${indexItems.length} packs con socialPack → ${outRoot}`)
console.log(`Canales activos: ${Object.entries(PACK_CHANNELS).filter(([, v]) => v).map(([k]) => k).join(', ') || '(ninguno)'}`)
console.log(`Índice admin: ${SITE}/admin/blog-packs`)
