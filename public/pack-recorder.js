/**
 * Grabador in-situ para Social Pack. Teleprompter + MediaRecorder.
 * El vídeo se descarga en el dispositivo. No se sube al CMS.
 */
(function () {
  const MODE_KEY = 'escarlet-recorder-mode'
  const SPEED_KEY = 'escarlet-recorder-speed'
  const NEXT_POS_KEY = 'escarlet-recorder-next-pos'
  const RECORDING_DB = 'escarlet-recorder'
  const RECORDING_STORE = 'last-takes'
  const SPEED_STEPS = [0.7, 0.85, 1, 1.2, 1.45]
  const HINTS = {
    teleprompter: 'El guion ocupa la pantalla. La cámara queda detrás al grabar.',
    pip: 'El guion manda. La cámara se ve en miniatura sin quitar lectura.',
    split: 'Texto arriba, cerca de la cámara del móvil. Vídeo completo abajo.',
    nearcam: 'Texto pegado arriba, mirando a la cámara. Franja de vídeo abajo.'
  }

  let options = {
    getScript: defaultGetScript,
    getSlug: defaultGetSlug
  }
  let started = false
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
  let refs = null

  function defaultGetScript() {
    const el = document.getElementById('video-canonical-json')
    if (!el) return ''
    try {
      return JSON.parse(el.textContent || '""')
    } catch {
      return String(el.textContent || '')
    }
  }

  function defaultGetSlug() {
    const btn = document.getElementById('btn-record')
    const fromBtn = btn && btn.getAttribute('data-slug')
    if (fromBtn) return fromBtn
    if (document.body && document.body.dataset.packSlug) return document.body.dataset.packSlug
    return 'guion'
  }

  function recordingKey() {
    return String((options.getSlug && options.getSlug()) || 'guion')
  }

  function fileBase() {
    return recordingKey() + '-guion.'
  }

  function flash(msg) {
    let toast = document.getElementById('pack-recorder-toast')
    if (!toast) {
      toast = document.createElement('div')
      toast.id = 'pack-recorder-toast'
      toast.className = 'recorder-toast'
      toast.setAttribute('role', 'status')
      document.body.appendChild(toast)
    }
    toast.textContent = msg || ''
    toast.classList.add('is-show')
    clearTimeout(toast._t)
    toast._t = setTimeout(() => toast.classList.remove('is-show'), 1400)
  }

  function recorderMarkup(slug) {
    const safe = String(slug || 'guion').replace(/[^a-zA-Z0-9._-]+/g, '-')
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
      <a class="btn recorder__download" id="recorder-download" hidden download="${safe}-guion.webm">Descargar</a>
      <button type="button" class="recorder__rec" id="recorder-start">Empezar</button>
      <button type="button" class="recorder__rec" id="recorder-stop" hidden>Detener</button>
    </div>
  </div>
</div>`
  }

  function ensureShell() {
    let shell = document.getElementById('recorder')
    if (!shell) {
      const wrap = document.createElement('div')
      wrap.innerHTML = recorderMarkup(recordingKey())
      document.body.appendChild(wrap.firstElementChild)
      shell = document.getElementById('recorder')
    }
    refs = {
      shell,
      scriptEl: document.getElementById('recorder-script'),
      preview: document.getElementById('recorder-preview'),
      countdownEl: document.getElementById('recorder-countdown'),
      statusEl: document.getElementById('recorder-status'),
      hintEl: document.getElementById('recorder-hint'),
      speedEl: document.getElementById('recorder-speed'),
      menuBtn: document.getElementById('recorder-menu-btn'),
      menuEl: document.getElementById('recorder-menu'),
      startBtn: document.getElementById('recorder-start'),
      stopBtn: document.getElementById('recorder-stop'),
      downloadBtn: document.getElementById('recorder-download'),
      closeBtn: document.getElementById('recorder-close'),
      slowerBtn: document.getElementById('recorder-slower'),
      fasterBtn: document.getElementById('recorder-faster'),
      nextBtn: document.getElementById('recorder-next'),
      modeBtns: Array.from(shell.querySelectorAll('.recorder__mode'))
    }
    return refs
  }

  function setStatus(text) {
    if (refs && refs.statusEl) refs.statusEl.textContent = text || ''
  }

  function setMenuOpen(open) {
    if (!refs || !refs.menuEl || !refs.menuBtn) return
    refs.menuEl.hidden = !open
    refs.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
    refs.menuBtn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú')
    refs.menuBtn.textContent = open ? '✕' : '☰'
    refs.shell.classList.toggle('is-menu-open', open)
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
    if (!refs || !refs.downloadBtn) return
    refs.downloadBtn.hidden = true
    refs.downloadBtn.removeAttribute('href')
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
        }, recordingKey())
      })
      db.close()
      return true
    } catch {
      return false
    }
  }

  async function loadLastRecording() {
    try {
      const db = await openRecordingDb()
      const row = await new Promise((resolve, reject) => {
        const tx = db.transaction(RECORDING_STORE, 'readonly')
        const req = tx.objectStore(RECORDING_STORE).get(recordingKey())
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return row
    } catch {
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
        tx.objectStore(RECORDING_STORE).delete(recordingKey())
      })
      db.close()
    } catch {
      /* ignore */
    }
  }

  function presentRecording(blob, type, fileName) {
    resetDownload()
    objectUrl = URL.createObjectURL(blob)
    refs.downloadBtn.href = objectUrl
    refs.downloadBtn.download = fileName
    refs.downloadBtn.hidden = false
  }

  async function restoreSavedDownload() {
    const saved = await loadLastRecording()
    if (!saved || !saved.blob) return false
    const type = saved.type || saved.blob.type || 'video/webm'
    const ext = type.includes('mp4') ? 'mp4' : 'webm'
    const fileName = saved.fileName || (fileBase() + ext)
    presentRecording(saved.blob, type, fileName)
    return true
  }

  function stopTracks() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      stream = null
    }
    if (refs && refs.preview) refs.preview.srcObject = null
  }

  function clearCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    if (!refs || !refs.countdownEl) return
    refs.countdownEl.hidden = true
    refs.countdownEl.textContent = ''
  }

  function stopPromptScroll() {
    if (promptTimer) {
      clearInterval(promptTimer)
      promptTimer = null
    }
  }

  function formatSpeed(factor) {
    const label = Number(factor).toFixed(2).replace(/\.?0+$/, '')
    return 'Velocidad x' + label
  }

  function applySpeed(factor, restart) {
    const nearest = SPEED_STEPS.reduce((best, step) => {
      return Math.abs(step - factor) < Math.abs(best - factor) ? step : best
    }, SPEED_STEPS[2])
    speedFactor = nearest
    try { localStorage.setItem(SPEED_KEY, String(speedFactor)) } catch { /* ignore */ }
    if (refs.speedEl) refs.speedEl.textContent = formatSpeed(speedFactor)
    refs.slowerBtn.disabled = SPEED_STEPS.indexOf(speedFactor) <= 0
    refs.fasterBtn.disabled = SPEED_STEPS.indexOf(speedFactor) >= SPEED_STEPS.length - 1
    if (restart && refs.shell.classList.contains('is-recording')) {
      startPromptScroll(false)
    }
  }

  function preferredSpeed() {
    try {
      const saved = Number(localStorage.getItem(SPEED_KEY))
      if (SPEED_STEPS.includes(saved)) return saved
    } catch { /* ignore */ }
    return 1
  }

  function changeSpeed(direction) {
    const idx = SPEED_STEPS.indexOf(speedFactor)
    const next = SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + direction))]
    applySpeed(next, true)
  }

  function liveScriptText() {
    return String((options.getScript && options.getScript()) || '').trim()
  }

  function renderScript(text) {
    refs.scriptEl.textContent = ''
    lineEls = []
    lineIndex = 0
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
    lines.forEach((line) => {
      const empty = !String(line).trim()
      const el = document.createElement(empty ? 'div' : 'p')
      el.className = empty ? 'recorder__break' : 'recorder__line'
      el.textContent = empty ? '\u00a0' : line
      if (!empty) lineEls.push(el)
      refs.scriptEl.appendChild(el)
    })
    refs.scriptEl.scrollTop = 0
  }

  function highlightLine(index) {
    lineEls.forEach((el, idx) => {
      el.classList.toggle('is-active', idx === index)
      el.classList.toggle('is-past', idx < index)
    })
    const active = lineEls[index]
    if (!active) return
    const mode = refs.shell.dataset.mode
    const block = (mode === 'split' || mode === 'nearcam') ? 'start' : 'center'
    active.scrollIntoView({ behavior: 'smooth', block: block })
  }

  function stepMsForScroll() {
    if (!lineEls.length) return 4000
    const words = liveScriptText().split(/\s+/).filter(Boolean).length
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
    if (refs.shell.classList.contains('is-recording')) {
      startPromptScroll(false)
    }
  }

  function updateOrientation() {
    if (!refs.preview.videoWidth || !refs.preview.videoHeight) return
    refs.shell.dataset.orientation = refs.preview.videoHeight > refs.preview.videoWidth ? 'vertical' : 'horizontal'
  }

  function applyMode(mode) {
    const next = HINTS[mode] ? mode : 'teleprompter'
    refs.shell.dataset.mode = next
    try { localStorage.setItem(MODE_KEY, next) } catch { /* ignore */ }
    if (refs.hintEl) refs.hintEl.textContent = HINTS[next]
    refs.modeBtns.forEach((btn) => {
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
    } catch { /* ignore */ }
    return 'teleprompter'
  }

  function clampNextPos(left, top) {
    const margin = 8
    const maxLeft = Math.max(margin, window.innerWidth - refs.nextBtn.offsetWidth - margin)
    const maxTop = Math.max(margin, window.innerHeight - refs.nextBtn.offsetHeight - margin)
    return {
      left: Math.min(maxLeft, Math.max(margin, left)),
      top: Math.min(maxTop, Math.max(margin, top))
    }
  }

  function placeNextBtn(left, top, save) {
    const pos = clampNextPos(left, top)
    refs.nextBtn.style.left = pos.left + 'px'
    refs.nextBtn.style.top = pos.top + 'px'
    refs.nextBtn.style.right = 'auto'
    refs.nextBtn.style.bottom = 'auto'
    if (save) {
      try { localStorage.setItem(NEXT_POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
    }
  }

  function restoreNextBtn() {
    try {
      const saved = JSON.parse(localStorage.getItem(NEXT_POS_KEY) || '')
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        placeNextBtn(saved.left, saved.top, false)
        return
      }
    } catch { /* ignore */ }
    const left = window.innerWidth - refs.nextBtn.offsetWidth - 18
    const top = window.innerHeight - refs.nextBtn.offsetHeight - 110
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
      const rect = refs.nextBtn.getBoundingClientRect()
      startX = event.clientX
      startY = event.clientY
      originLeft = rect.left
      originTop = rect.top
      refs.nextBtn.classList.add('is-dragging')
      try { refs.nextBtn.setPointerCapture(event.pointerId) } catch { /* ignore */ }
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
      refs.nextBtn.classList.remove('is-dragging')
      const rect = refs.nextBtn.getBoundingClientRect()
      placeNextBtn(rect.left, rect.top, true)
    }

    refs.nextBtn.addEventListener('pointerdown', onStart)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    refs.nextBtn.addEventListener('click', (event) => {
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
    ensureShell()
    applyMode(preferredMode())
    applySpeed(preferredSpeed(), false)
    renderScript(liveScriptText())
    stopPromptScroll()
    setMenuOpen(false)
    refs.shell.classList.remove('is-recording')
    setStatus('Preparando cámara')
    refs.startBtn.hidden = false
    refs.stopBtn.hidden = true
    refs.shell.classList.add('is-open')
    refs.shell.setAttribute('aria-hidden', 'false')
    document.body.classList.add('recorder-open')
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
      refs.preview.srcObject = stream
      await refs.preview.play().catch(() => {})
      updateOrientation()
      refs.preview.onloadedmetadata = updateOrientation
      setStatus(hadSaved
        ? 'Listo. Tienes un vídeo pendiente de descargar.'
        : 'Listo para grabar')
    } catch {
      setStatus(hadSaved
        ? 'Último vídeo guardado. La cámara no abrió.'
        : 'La cámara no abrió. Puedes leer el guion igual.')
      flash('Permite el acceso a la cámara')
    }
  }

  function closeRecorder() {
    if (!refs) return
    clearCountdown()
    stopPromptScroll()
    starting = false
    setMenuOpen(false)
    refs.shell.classList.remove('is-recording')
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop() } catch { /* ignore */ }
    }
    recorder = null
    chunks = []
    stopTracks()
    resetDownload()
    refs.shell.classList.remove('is-open')
    refs.shell.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('recorder-open')
    setStatus('')
    refs.startBtn.hidden = false
    refs.stopBtn.hidden = true
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
    } catch {
      flash('Este navegador no puede grabar vídeo')
      return
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      stopPromptScroll()
      refs.shell.classList.remove('is-recording')
      const type = (recorder && recorder.mimeType) || mimeType || 'video/webm'
      const blob = new Blob(chunks, { type })
      const ext = type.includes('mp4') ? 'mp4' : 'webm'
      const name = fileBase() + ext
      presentRecording(blob, type, name)
      refs.startBtn.hidden = false
      refs.stopBtn.hidden = true
      const saved = await saveLastRecording(blob, type, name)
      setStatus(saved
        ? 'Vídeo guardado aquí. Descárgalo para liberarlo.'
        : 'Vídeo listo en esta sesión. Descárgalo ahora.')
      flash(saved ? 'Vídeo guardado' : 'Vídeo listo')
    }

    recorder.start(250)
    refs.startBtn.hidden = true
    refs.stopBtn.hidden = false
    refs.shell.classList.add('is-recording')
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
    refs.countdownEl.hidden = false
    refs.countdownEl.textContent = String(n)
    setStatus('Cuenta regresiva')
    clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      n -= 1
      if (n > 0) {
        refs.countdownEl.textContent = String(n)
        return
      }
      clearCountdown()
      starting = false
      beginRecording()
    }, 1000)
  }

  function bindOnce() {
    ensureShell()
    refs.startBtn.addEventListener('click', () => { startWithCountdown() })
    refs.stopBtn.addEventListener('click', () => {
      clearCountdown()
      starting = false
      stopPromptScroll()
      refs.shell.classList.remove('is-recording')
      if (recorder && recorder.state === 'recording') recorder.stop()
      setStatus('Procesando')
    })
    refs.closeBtn.addEventListener('click', () => { closeRecorder() })
    refs.downloadBtn.addEventListener('click', () => {
      flash('Descarga en tu dispositivo')
      clearLastRecording().then(() => {
        setStatus('Descargado. La copia del navegador se eliminó.')
      })
    })
    refs.slowerBtn.addEventListener('click', () => { changeSpeed(-1) })
    refs.fasterBtn.addEventListener('click', () => { changeSpeed(1) })
    refs.menuBtn.addEventListener('click', () => {
      setMenuOpen(refs.menuEl.hidden)
    })
    refs.modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyMode(btn.getAttribute('data-mode'))
        setMenuOpen(false)
      })
    })
    bindNextDrag()
    window.addEventListener('resize', () => {
      if (!refs.shell.classList.contains('is-open')) return
      const rect = refs.nextBtn.getBoundingClientRect()
      placeNextBtn(rect.left, rect.top, true)
    })
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('#btn-record, [data-open-recorder]')
      if (!btn) return
      event.preventDefault()
      openRecorder()
    })
  }

  function init(nextOptions) {
    if (nextOptions && typeof nextOptions === 'object') {
      options = {
        getScript: nextOptions.getScript || options.getScript || defaultGetScript,
        getSlug: nextOptions.getSlug || options.getSlug || defaultGetSlug
      }
    }
    if (started) return
    started = true
    bindOnce()
  }

  window.EscarletPackRecorder = {
    init,
    open: openRecorder,
    close: closeRecorder
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('btn-record') || document.getElementById('video-canonical-json')) {
        init()
      }
    })
  } else if (document.getElementById('btn-record') || document.getElementById('video-canonical-json')) {
    init()
  }
})()
