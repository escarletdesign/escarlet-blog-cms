const ICONS = {
  editor: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  preview: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  more: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  image: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
  check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
}

const STATUS_LABELS = {
  draft: 'Borrador',
  review: 'En revisión',
  published: 'Publicado'
}

const STEP_HINTS = {
  escribir: 'Paso 1 de 3. Escribe el contenido y guarda antes de seguir.',
  portada: 'Paso 2 de 3. Pasa el ratón por una foto. El recuadro es portada. El más la mete en el carrusel.',
  revisar: 'Paso 3 de 3. Revisa el resultado y publica cuando esté listo.'
}

const login = document.getElementById('login')
const app = document.getElementById('app')
const tokenInput = document.getElementById('token')
const siteFilter = document.getElementById('siteFilter')
const statusFilter = document.getElementById('statusFilter')
const list = document.getElementById('list')
const form = document.getElementById('form')
const seoResult = document.getElementById('seoResult')
const previewFrame = document.getElementById('previewFrame')
const previewUrl = document.getElementById('previewUrl')
const mediaGrid = document.getElementById('mediaGrid')
const libraryGrid = document.getElementById('libraryGrid')
const libraryKindFilter = document.getElementById('libraryKindFilter')
const brandFile = document.getElementById('brandFile')
const brandContent = document.getElementById('brandContent')
const refGrid = document.getElementById('refGrid')
const siteDomain = document.getElementById('siteDomain')
const siteName = document.getElementById('siteName')
const siteWebhook = document.getElementById('siteWebhook')
const siteCoolifyToken = document.getElementById('siteCoolifyToken')
const siteTokenStatus = document.getElementById('siteTokenStatus')
const rebuildResult = document.getElementById('rebuildResult')
const siteHumanApproval = document.getElementById('siteHumanApproval')
const siteList = document.getElementById('siteList')
const siteListCard = document.getElementById('siteListCard')
const siteOnboardCard = document.getElementById('siteOnboardCard')
const siteConfigCard = document.getElementById('siteConfigCard')
const onboardHint = document.getElementById('onboardHint')
const onboardSummary = document.getElementById('onboardSummary')
const onboardDone = document.getElementById('onboardDone')
const toastEl = document.getElementById('toast')
const toastMessage = document.getElementById('toastMessage')
const toastClose = document.getElementById('toastClose')
const siteLabel = document.getElementById('siteLabel')
const publishBanner = document.getElementById('publishBanner')
const publishPostBtn = document.getElementById('publishPost')
const loginError = document.getElementById('loginError')
const enterBtn = document.getElementById('enter')
const previewStatus = document.getElementById('previewStatus')
const imagePreview = document.getElementById('imagePreview')
const imageUrlInput = document.getElementById('imageUrlInput')
const bodyContent = document.getElementById('bodyContent')
const menuToggle = document.getElementById('menuToggle')
const sidebar = document.getElementById('sidebar')
const sidebarBackdrop = document.getElementById('sidebarBackdrop')
const workspaceTitle = document.getElementById('workspaceTitle')
const workspaceStatusBadge = document.getElementById('workspaceStatusBadge')
const workspaceHint = document.getElementById('workspaceHint')
const editorStatusBadge = document.getElementById('editorStatusBadge')
const postStatusInput = document.getElementById('postStatus')
const topbarHint = document.getElementById('topbarHint')
const authRoleBadge = document.getElementById('authRoleBadge')

const ONBOARD_HINTS = {
  basics: 'Paso 1 de 3. Datos básicos del proyecto.',
  coolify: 'Paso 2 de 3. Webhook de Coolify (puedes saltarlo).',
  review: 'Paso 3 de 3. Revisa y crea el sitio.'
}

let bodyEditor = null
let cachedPosts = []
let cachedSiteHandles = []
let activeSiteHandle = ''
let authSession = { role: 'admin', canCreateSites: true, canManageAllSites: true, sites: [] }
let humanApprovalRequired = true
let socialPackChannels = {
  substack: true,
  linkedin: true,
  x: true,
  videoScript: true,
  instagramCarousel: true
}
let editingOriginalSlug = ''
let currentStep = 'escribir'
let currentRoute = { view: 'entradas' }
let onboardStep = 'basics'
let token = localStorage.getItem('escarlet_cms_token') || ''
let navigating = false
if (siteFilter) {
  siteFilter.dataset.pending = localStorage.getItem('escarlet_cms_site') || ''
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'Borrador'
}

function setBadge(el, status) {
  if (!el) return
  const s = status || 'draft'
  el.className = `badge ${s}`
  el.textContent = statusLabel(s)
}

function toast(message, options = {}) {
  const duration = options.duration ?? (options.sticky ? 0 : 10000)
  const text = String(message || '').slice(0, 520)
  if (toastMessage) toastMessage.textContent = text
  else toastEl.textContent = text
  toastEl.hidden = false
  toastEl.classList.toggle('is-sticky', Boolean(options.sticky || duration === 0))
  clearTimeout(toastEl._t)
  if (duration > 0) {
    toastEl._t = setTimeout(() => { toastEl.hidden = true }, duration)
  }
}

toastClose?.addEventListener('click', () => {
  clearTimeout(toastEl._t)
  toastEl.hidden = true
})

async function withBusy(btn, labelBusy, fn) {
  if (!btn) return fn()
  const prev = btn.innerHTML
  const prevDisabled = btn.disabled
  btn.disabled = true
  btn.setAttribute('aria-busy', 'true')
  if (labelBusy) btn.textContent = labelBusy
  try {
    return await fn()
  } finally {
    btn.disabled = prevDisabled
    btn.removeAttribute('aria-busy')
    btn.innerHTML = prev
  }
}

function setPublishLabels(status) {
  const label =
    status === 'review'
      ? 'Publicar en vivo'
      : humanApprovalRequired
        ? 'Enviar a revisión'
        : 'Publicar en vivo'
  if (publishPostBtn) publishPostBtn.textContent = label
}

function normalizeSocialPackChannels(raw) {
  return {
    substack: raw?.substack !== false,
    linkedin: raw?.linkedin !== false,
    x: raw?.x !== false,
    videoScript: raw?.videoScript !== false,
    instagramCarousel: raw?.instagramCarousel !== false
  }
}

function readChannelCheckboxes() {
  const keys = ['substack', 'linkedin', 'x', 'videoScript', 'instagramCarousel']
  const next = {}
  for (const key of keys) {
    const el = document.querySelector(`[data-channel-key="${key}"]`)
    next[key] = el ? Boolean(el.checked) : true
  }
  return next
}

function writeChannelCheckboxes(channels) {
  const normalized = normalizeSocialPackChannels(channels)
  for (const [key, enabled] of Object.entries(normalized)) {
    const el = document.querySelector(`[data-channel-key="${key}"]`)
    if (el) el.checked = Boolean(enabled)
  }
}

function applySocialPackChannelUi(channels = socialPackChannels) {
  socialPackChannels = normalizeSocialPackChannels(channels)
  const map = {
    substack: socialPackChannels.substack,
    linkedin: socialPackChannels.linkedin,
    x: socialPackChannels.x,
    videoScript: socialPackChannels.videoScript,
    instagramCarousel: socialPackChannels.instagramCarousel
  }
  for (const [key, enabled] of Object.entries(map)) {
    document.querySelectorAll(`[data-channel="${key}"]`).forEach((el) => {
      el.hidden = !enabled
    })
  }
  const any =
    socialPackChannels.substack ||
    socialPackChannels.linkedin ||
    socialPackChannels.x ||
    socialPackChannels.videoScript ||
    socialPackChannels.instagramCarousel
  const block = document.getElementById('socialPackBlock')
  if (block) block.hidden = !any
}

function parseInstagramSlides(raw) {
  const text = String(raw || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((slide) => ({
        imageUrl: String(slide?.imageUrl || '').trim(),
        alt: String(slide?.alt || '').trim(),
        headline: String(slide?.headline || '').trim(),
        body: String(slide?.body || '').trim()
      }))
      .filter((slide) => slide.imageUrl || slide.alt || slide.headline || slide.body)
  } catch {
    return null
  }
}

function formatInstagramSlides(slides) {
  if (!Array.isArray(slides) || !slides.length) return ''
  return JSON.stringify(slides, null, 2)
}

function mediaPathKey(url) {
  const raw = String(url || '').trim()
  const match = raw.match(/(\/media\/[^\s?#]+)/)
  return (match ? match[1] : raw).replace(/\/$/, '')
}

function currentCoverKey() {
  return mediaPathKey(form.imageUrl?.value)
}

function readCarouselSlides() {
  const slides = parseInstagramSlides(form.instagramSlides?.value)
  return Array.isArray(slides) ? slides : []
}

function writeCarouselSlides(slides) {
  if (form.instagramSlides) form.instagramSlides.value = formatInstagramSlides(slides)
  renderCarouselStrip()
}

function renderCarouselStrip() {
  const el = document.getElementById('carouselStrip')
  if (!el) return
  const slides = readCarouselSlides()
  el.innerHTML = ''
  if (!slides.length) {
    el.innerHTML = '<p class="empty carousel-empty">El carrusel está vacío. En una foto de abajo, pulsa el más.</p>'
    return
  }
  slides.forEach((slide, index) => {
    const item = document.createElement('div')
    item.className = 'carousel-strip-item'
    const indexBadge = document.createElement('span')
    indexBadge.className = 'carousel-strip-index'
    indexBadge.textContent = String(index + 1)
    const img = document.createElement('img')
    img.src = mediaPathKey(slide.imageUrl) || slide.imageUrl
    img.alt = slide.alt || `Slide ${index + 1}`
    img.title = slide.headline || slide.alt || `Slide ${index + 1}`
    img.onclick = () => openMediaLightbox(img.src, img.alt)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-btn icon-btn--danger carousel-strip-remove'
    remove.title = 'Quitar del carrusel'
    remove.setAttribute('aria-label', 'Quitar del carrusel')
    remove.innerHTML = ICONS.x
    remove.onclick = (event) => {
      event.stopPropagation()
      const next = readCarouselSlides().filter((_, i) => i !== index)
      writeCarouselSlides(next)
      persistPost().then(() => loadMedia().catch(() => {}))
    }
    item.append(img, indexBadge, remove)
    el.appendChild(item)
  })
}

function rebuildSaveMessage(data, fallback = 'Entrada guardada') {
  const published = (data?.post?.status || postStatusInput.value) === 'published'
  if (!published) return { text: fallback, sticky: false }
  if (data?.rebuild?.ok) {
    return { text: 'Guardado. Rebuild de la web disparado. La portada pública cambia cuando termine Coolify.', sticky: false }
  }
  const detail = data?.rebuild?.message || 'Revisa el webhook de Coolify en Sitio.'
  return {
    text: `Guardado en el CMS. La web pública no se actualizó. ${detail}`,
    sticky: true
  }
}

function showPublishBanner(text, kind = 'info') {
  if (!publishBanner) return
  if (!text) {
    publishBanner.hidden = true
    publishBanner.textContent = ''
    publishBanner.className = 'publish-banner'
    return
  }
  publishBanner.hidden = false
  publishBanner.textContent = text
  publishBanner.className = `publish-banner is-${kind}`
}

function mediaSrc(item) {
  if (!item) return ''
  const path = item.path || ''
  if (path.startsWith('/media/')) return path
  const url = item.url || item.imageUrl || ''
  if (url.startsWith('/media/')) return url
  const match = String(url).match(/(\/media\/[^\s?#]+)/)
  if (match) return match[1]
  const filename = String(url).split('/').pop()?.split('?')[0]
  if (filename) return `/media/${siteFilter.value.trim() || 'escarlet'}/${filename}`
  if (/^https?:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url)) return url
  return url
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      resolve(text.includes(',') ? text.split(',')[1] : text)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function applyImageToPost(item) {
  const src = mediaSrc(item)
  if (!src) {
    toast('Esta imagen no tiene URL usable.')
    return
  }
  if (imageUrlInput) imageUrlInput.value = src
  if (form.imageAlt && item.alt) form.imageAlt.value = item.alt
  updateImagePreview()
  persistPost().then(() => loadMedia().catch(() => {}))
}

function addImageToCarousel(item) {
  const src = mediaSrc(item)
  if (!src) {
    toast('Esta imagen no tiene URL usable.')
    return
  }
  const slides = readCarouselSlides()
  if (slides.length >= 7) {
    toast('El carrusel admite 7 slides como máximo')
    return
  }
  const key = mediaPathKey(src)
  if (slides.some((slide) => mediaPathKey(slide.imageUrl) === key)) {
    writeCarouselSlides(slides.filter((slide) => mediaPathKey(slide.imageUrl) !== key))
    persistPost().then(() => loadMedia().catch(() => {}))
    return
  }
  slides.push({
    imageUrl: src,
    alt: item.alt || '',
    headline: item.alt || '',
    body: ''
  })
  writeCarouselSlides(slides)
  persistPost().then(() => loadMedia().catch(() => {}))
}

function openMediaLightbox(src, alt = '') {
  const box = document.getElementById('mediaLightbox')
  const img = document.getElementById('mediaLightboxImg')
  const caption = document.getElementById('mediaLightboxCaption')
  if (!box || !img || !src) return
  img.src = src
  img.alt = alt || ''
  if (caption) caption.textContent = alt || src
  box.hidden = false
  document.body.classList.add('lightbox-open')
}

function closeMediaLightbox() {
  const box = document.getElementById('mediaLightbox')
  const img = document.getElementById('mediaLightboxImg')
  if (box) box.hidden = true
  if (img) img.removeAttribute('src')
  document.body.classList.remove('lightbox-open')
}

function createIconBtn({ className, title, icon, onClick, pressed = false, disabled = false }) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = className
  btn.title = title
  btn.setAttribute('aria-label', title)
  if (pressed) btn.setAttribute('aria-pressed', 'true')
  btn.disabled = disabled
  btn.innerHTML = icon
  btn.onclick = (event) => {
    event.stopPropagation()
    if (!disabled) onClick()
  }
  return btn
}

function renderMediaGrid(target, items, { allowUse = false } = {}) {
  target.innerHTML = ''
  if (!items.length) {
    target.innerHTML = '<p class="empty">Esta parrilla está vacía.</p>'
    return
  }
  const coverKey = currentCoverKey()
  const slideKeys = new Set(readCarouselSlides().map((slide) => mediaPathKey(slide.imageUrl)))
  for (const item of items) {
    const div = document.createElement('div')
    div.className = 'media-card'
    const src = mediaSrc(item)
    const key = mediaPathKey(src)
    const isCover = Boolean(coverKey && key && coverKey === key)
    const inCarousel = Boolean(key && slideKeys.has(key))
    const label = item.alt || item.filename || src
    if (item.ok === false) div.classList.add('media-card--broken')
    if (isCover) div.classList.add('media-card--current')
    if (inCarousel) div.classList.add('media-card--slide')
    const img = document.createElement('img')
    img.alt = item.alt || ''
    img.loading = 'lazy'
    img.src = src
    img.title = label
    img.onclick = () => openMediaLightbox(src, item.alt || item.filename || '')
    img.onerror = () => {
      div.classList.add('media-card--broken')
    }
    const badges = document.createElement('div')
    badges.className = 'media-card-badges'
    if (isCover) {
      const coverBadge = document.createElement('span')
      coverBadge.className = 'media-badge media-badge--cover'
      coverBadge.textContent = 'Portada'
      badges.appendChild(coverBadge)
    }
    if (inCarousel) {
      const slideBadge = document.createElement('span')
      slideBadge.className = 'media-badge media-badge--slide'
      slideBadge.textContent = 'Carrusel'
      badges.appendChild(slideBadge)
    }
    if (item.ok === false) {
      const brokenBadge = document.createElement('span')
      brokenBadge.className = 'media-badge media-badge--broken'
      brokenBadge.textContent = 'Rota'
      badges.appendChild(brokenBadge)
    }
    const overlay = document.createElement('div')
    overlay.className = 'media-card-overlay'
    if (allowUse && item.ok !== false) {
      overlay.appendChild(createIconBtn({
        className: `icon-btn${isCover ? ' is-on' : ''}`,
        title: isCover ? 'Ya es la portada' : 'Usar como portada',
        icon: isCover ? ICONS.check : ICONS.image,
        pressed: isCover,
        disabled: isCover,
        onClick: () => applyImageToPost(item)
      }))
      if (socialPackChannels.instagramCarousel) {
        overlay.appendChild(createIconBtn({
          className: `icon-btn${inCarousel ? ' is-on' : ''}`,
          title: inCarousel ? 'Quitar del carrusel' : 'Añadir al carrusel',
          icon: inCarousel ? ICONS.check : ICONS.plus,
          pressed: inCarousel,
          onClick: () => addImageToCarousel(item)
        }))
      }
    }
    overlay.appendChild(createIconBtn({
      className: 'icon-btn icon-btn--danger',
      title: 'Eliminar del archivo',
      icon: ICONS.trash,
      onClick: async () => {
        if (!item.id && !item.path && !item.url) {
          toast('Falta identificar esta imagen.')
          return
        }
        if (!confirm('¿Eliminar esta imagen del CMS?')) return
        try {
          const site = siteFilter.value.trim() || 'escarlet'
          await api('/api/admin/media/delete', {
            method: 'POST',
            body: JSON.stringify({
              site,
              id: item.id || undefined,
              path: item.path || item.url || undefined
            })
          })
          toast('Imagen eliminada')
          if (target === mediaGrid) await loadMedia()
          else if (target === libraryGrid) await loadLibrary()
          else await loadRefs()
        } catch (err) {
          toast(err.message)
        }
      }
    }))
    div.append(img, badges, overlay)
    target.appendChild(div)
  }
}

function createToastEditor(mountId, height) {
  const mount = document.getElementById(mountId)
  if (!mount || typeof toastui === 'undefined') return null
  mount.innerHTML = ''
  return new toastui.Editor({
    el: mount,
    height: height || '360px',
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    usageStatistics: false,
    hideModeSwitch: false,
    toolbarItems: [
      ['heading', 'bold', 'italic'],
      ['hr', 'quote'],
      ['ul', 'ol', 'task'],
      ['link'],
      ['scrollSync']
    ]
  })
}

function ensureBodyEditor() {
  if (bodyEditor) return bodyEditor
  bodyEditor = createToastEditor('bodyEditorMount', '420px')
  return bodyEditor
}

function looksLikeBodyHtml(text = '') {
  return /<(?:p|h[1-6]|div|ul|ol|li|article|blockquote|br|figure|section)\b/i.test(String(text).trim())
}

function bodyValue() {
  // La web pública inyecta bodyHtml como HTML. Guardar Markdown deja ## ** visibles.
  if (bodyEditor) return bodyEditor.getHTML() || ''
  return bodyContent?.value || ''
}

function setBodyValue(text) {
  ensureBodyEditor()
  const raw = text || ''
  if (bodyEditor) {
    if (looksLikeBodyHtml(raw)) bodyEditor.setHTML(raw)
    else bodyEditor.setMarkdown(raw)
  } else if (bodyContent) {
    bodyContent.value = raw
  }
}

function brandValue() {
  return brandContent?.value || ''
}

function setBrandValue(text) {
  if (brandContent) brandContent.value = text || ''
}

function updateImagePreview() {
  const src = mediaSrc({ url: imageUrlInput?.value || form.imageUrl?.value || '' })
  if (!src) {
    imagePreview.hidden = true
    imagePreview.innerHTML = ''
    return
  }
  imagePreview.hidden = false
  imagePreview.innerHTML = `<img src="${src}" alt="Vista previa de portada" title="Ver a tamaño real" />`
  const previewImg = imagePreview.querySelector('img')
  if (previewImg) {
    previewImg.onclick = () => openMediaLightbox(src, 'Portada')
    previewImg.onerror = () => {
      imagePreview.innerHTML =
        '<p class="image-preview-error">Esta portada no se puede mostrar. El archivo está incompleto o roto. Súbelo otra vez desde Media.</p>'
    }
  }
}

function closeSidebar() {
  sidebar?.classList.remove('open')
  sidebarBackdrop?.setAttribute('hidden', '')
  document.body.classList.remove('nav-open')
  if (menuToggle) {
    menuToggle.setAttribute('aria-expanded', 'false')
    menuToggle.setAttribute('aria-label', 'Abrir menú')
  }
}

function openSidebar() {
  sidebar?.classList.add('open')
  sidebarBackdrop?.removeAttribute('hidden')
  document.body.classList.add('nav-open')
  if (menuToggle) {
    menuToggle.setAttribute('aria-expanded', 'true')
    menuToggle.setAttribute('aria-label', 'Cerrar menú')
  }
}

function authHeaders() {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errors = data.blockingErrors || data.validation?.errors || data.errors || []
    const warnings = data.warnings || data.validation?.warnings || []
    let message =
      data.message ||
      data.rebuild?.message ||
      data.error_description ||
      data.error ||
      res.statusText ||
      `Error HTTP ${res.status}`
    if (errors.length) message += `\nBloquean: ${errors.join(' · ')}`
    if (warnings.length) message += `\nAvisos: ${warnings.slice(0, 4).join(' · ')}`
    const err = new Error(message)
    err.payload = data
    err.status = res.status
    throw err
  }
  return data
}

function showRebuildResult(rebuild, fallbackMessage = '') {
  const payload = rebuild && typeof rebuild === 'object'
    ? rebuild
    : { ok: false, message: fallbackMessage || 'Sin respuesta del webhook' }
  rebuildResult.textContent = JSON.stringify(payload, null, 2)
  rebuildResult.classList.toggle('is-ok', Boolean(payload.ok))
  rebuildResult.classList.toggle('is-error', !payload.ok)
  toast(payload.ok ? (payload.message || 'Webhook OK') : (payload.message || 'Webhook falló'))
}

/* ---------- Routing (History API + hash) ---------- */

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').trim()
  if (!raw || raw === 'entradas') return { view: 'entradas' }
  if (raw === 'marca') return { view: 'marca' }
  if (raw === 'media') return { view: 'media' }
  if (raw === 'sitio') return { view: 'sitio' }
  const mNew = raw.match(/^entrada\/nueva(?:\/(escribir|portada|revisar))?$/)
  if (mNew) return { view: 'entrada', slug: null, isNew: true, step: mNew[1] || 'escribir' }
  const m = raw.match(/^entrada\/([^/]+)(?:\/(escribir|portada|revisar))?$/)
  if (m) return { view: 'entrada', slug: decodeURIComponent(m[1]), isNew: false, step: m[2] || 'escribir' }
  return { view: 'entradas' }
}

function routeToHash(route) {
  if (!route || route.view === 'entradas') return '#/entradas'
  if (route.view === 'marca') return '#/marca'
  if (route.view === 'media') return '#/media'
  if (route.view === 'sitio') return '#/sitio'
  if (route.view === 'entrada') {
    const step = route.step || 'escribir'
    if (route.isNew || !route.slug) return `#/entrada/nueva/${step}`
    return `#/entrada/${encodeURIComponent(route.slug)}/${step}`
  }
  return '#/entradas'
}

function navigate(route, { replace = false } = {}) {
  const next = { ...route }
  const hash = routeToHash(next)
  navigating = true
  if (replace) history.replaceState(next, '', hash)
  else {
    const currentHash = location.hash || '#/entradas'
    if (currentHash === hash) history.replaceState(next, '', hash)
    else history.pushState(next, '', hash)
  }
  navigating = false
  applyRoute(next)
}

function applyRoute(route) {
  currentRoute = route || { view: 'entradas' }
  const view = currentRoute.view || 'entradas'

  document.querySelectorAll('.nav-btn[data-route]').forEach((b) => {
    const active =
      (view === 'entradas' || view === 'entrada') ? b.dataset.route === 'entradas' : b.dataset.route === view
    b.classList.toggle('active', active)
  })

  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.remove('active')
    p.hidden = true
    p.setAttribute('aria-hidden', 'true')
  })

  if (view === 'entrada') {
    const panel = document.getElementById('panel-entrada')
    panel.hidden = false
    panel.classList.add('active')
    panel.setAttribute('aria-hidden', 'false')
    showStep(currentRoute.step || 'escribir')
    if (topbarHint) {
      topbarHint.textContent = 'Usa el botón atrás del navegador para volver al paso anterior o a la lista.'
    }
  } else {
    const panel = document.getElementById('panel-' + view)
    if (panel) {
      panel.hidden = false
      panel.classList.add('active')
      panel.setAttribute('aria-hidden', 'false')
    }
    if (topbarHint) {
      if (view === 'marca') {
        topbarHint.textContent = 'Textos y referencias que usa el agente al crear contenido.'
      } else if (view === 'media') {
        topbarHint.textContent = 'Pulsa una foto para verla a tamaño real. El archivo guarda el original, no la miniatura.'
      } else if (view === 'sitio') {
        topbarHint.textContent = canCreateSites()
          ? 'Crea un sitio nuevo o ajusta dominio y webhook del activo.'
          : `Ajusta el sitio ${authSession?.site || 'activo'}. Crear sitios pide token de super-admin.`
      } else {
        topbarHint.textContent =
          'Empieza por Entradas. Abre un borrador y avanza paso a paso hasta publicar.'
      }
    }
  }

  if (view === 'marca') {
    loadBrand().catch((e) => toast(e.message))
    loadRefs().catch((e) => toast(e.message))
  }
  if (view === 'media') {
    loadLibrary().catch((e) => toast(e.message))
  }
  if (view === 'sitio') {
    loadSites().catch((e) => toast(e.message))
    loadSite().catch((e) => toast(e.message))
  }
  closeSidebar()
}

function showStep(step) {
  currentStep = step || 'escribir'
  document.querySelectorAll('.step-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.step === currentStep)
  })
  document.querySelectorAll('.step-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'step-' + currentStep)
  })
  if (workspaceHint) workspaceHint.textContent = STEP_HINTS[currentStep] || ''

  if (currentStep === 'escribir') {
    ensureBodyEditor()
    setTimeout(() => {
      try { bodyEditor?.setHeight('420px') } catch {}
    }, 50)
  }
  if (currentStep === 'portada') {
    loadMedia().catch((e) => toast(e.message))
  }
  if (currentStep === 'revisar') {
    const slug = editingOriginalSlug || form.slug.value.trim()
    if (slug) showPreviewForSlug(slug)
    else {
      previewStatus.textContent = 'Guarda la entrada con un slug para ver la vista previa.'
      previewFrame.src = 'about:blank'
      previewUrl.textContent = ''
    }
  }
}

function goToStep(step, { replace = false } = {}) {
  const slug = editingOriginalSlug || form.slug.value.trim() || null
  navigate({
    view: 'entrada',
    slug,
    isNew: !slug,
    step
  }, { replace })
}

function openPostWorkspace(post, step = 'escribir', { replace = false } = {}) {
  if (post) fillFormFields(post)
  else resetFormFields()
  navigate({
    view: 'entrada',
    slug: post?.slug || null,
    isNew: !post?.slug,
    step
  }, { replace })
}

function updateWorkspaceChrome() {
  const title = form.title.value.trim() || (editingOriginalSlug ? editingOriginalSlug : 'Nueva entrada')
  const status = postStatusInput.value || 'draft'
  if (workspaceTitle) workspaceTitle.textContent = title
  setBadge(workspaceStatusBadge, status)
  setBadge(editorStatusBadge, status)
  setPublishLabels(status)
  syncEditorLifecycleButtons(status)
}

function fillFormFields(p) {
  editingOriginalSlug = p.slug || ''
  form.title.value = p.title || ''
  form.slug.value = p.slug || ''
  form.authorName.value = p.authorName || 'Silvia'
  postStatusInput.value = p.status || 'draft'
  form.datePublished.value = p.datePublished || ''
  form.dateModified.value = p.dateModified || ''
  form.metaTitleEs.value = p.metaTitle?.es || ''
  form.metaDescriptionEs.value = p.metaDescription?.es || ''
  form.excerptEs.value = p.excerptEs || ''
  form.imageUrl.value = p.imageUrl || ''
  form.imageAlt.value = p.imageAlt || ''
  form.relatedSlugs.value = (p.relatedSlugs || []).join(', ')
  form.substackTitle.value = p.socialPack?.substackTitle || ''
  form.substackBody.value = p.socialPack?.substackBody || ''
  form.linkedin.value = p.socialPack?.linkedin || ''
  form.x.value = p.socialPack?.x || ''
  if (form.videoScript) form.videoScript.value = p.socialPack?.videoScript || ''
  if (form.instagramCaption) form.instagramCaption.value = p.socialPack?.instagramCaption || ''
  if (form.instagramSlides) form.instagramSlides.value = formatInstagramSlides(p.socialPack?.instagramSlides)
  form.bodyHtml.value = p.bodyHtml || ''
  setBodyValue(p.bodyHtml || '')
  updateImagePreview()
  renderCarouselStrip()
  showPublishBanner('')
  applySocialPackChannelUi(socialPackChannels)
  updateWorkspaceChrome()
}

function resetFormFields() {
  editingOriginalSlug = ''
  form.reset()
  form.authorName.value = 'Silvia'
  postStatusInput.value = 'draft'
  setBodyValue('')
  updateImagePreview()
  renderCarouselStrip()
  showPublishBanner('')
  if (seoResult) {
    seoResult.hidden = true
    seoResult.innerHTML = ''
  }
  updateWorkspaceChrome()
}

function buildPreviewUrl(slug) {
  const site = siteFilter.value.trim() || 'escarlet'
  return `/preview/${site}/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`
}

function updatePreviewStatus(slug) {
  if (!previewStatus) return
  const post = cachedPosts.find((p) => p.slug === slug)
  const status = post?.status || postStatusInput.value || 'draft'
  if (!post && !slug) {
    previewStatus.innerHTML = ''
    setPublishLabels('draft')
    return
  }
  const hint =
    status === 'review'
      ? 'Listo para tu OK. Pulsa Publicar en vivo para mandarlo al blog.'
      : status === 'draft'
        ? 'Borrador. El siguiente paso lo envía a revisión humana.'
        : 'Ya está publicado en el blog.'
  previewStatus.innerHTML = `Estado actual. <span class="badge ${status}">${statusLabel(status)}</span> ${hint}`
  setPublishLabels(status)
}

function showPreviewForSlug(slug, { newTab = false } = {}) {
  if (!slug) {
    toast('Guarda la entrada con un slug para previsualizar')
    return
  }
  updatePreviewStatus(slug)
  const url = buildPreviewUrl(slug)
  if (newTab) {
    window.open(url, '_blank', 'noopener')
    return
  }
  previewUrl.innerHTML = `<a href="${url}" target="_blank" rel="noopener">${location.origin}${url}</a>`
  previewFrame.src = url
}

function mergeAuthSession(partial = {}) {
  const nextRole = partial.role || authSession?.role || 'admin'
  authSession = {
    role: nextRole,
    site:
      Object.prototype.hasOwnProperty.call(partial, 'site')
        ? partial.site
        : (authSession?.site ?? null),
    sites: Array.isArray(partial.sites) ? partial.sites : (authSession?.sites || []),
    canCreateSites:
      typeof partial.canCreateSites === 'boolean'
        ? partial.canCreateSites
        : Boolean(authSession?.canCreateSites),
    canManageAllSites:
      typeof partial.canManageAllSites === 'boolean'
        ? partial.canManageAllSites
        : Boolean(authSession?.canManageAllSites)
  }
  if (authSession.role === 'admin') {
    authSession.canCreateSites = true
    authSession.canManageAllSites = true
    authSession.site = null
  }
  return authSession
}

function canCreateSites() {
  return authSession?.role === 'admin' || Boolean(authSession?.canCreateSites)
}

function isSuperAdminSession() {
  return authSession?.role === 'admin'
}

async function afterLogin() {
  try {
    mergeAuthSession(await api('/api/admin/session'))
  } catch {
    // Conserva el rol del login si ya lo tenemos. Solo asume admin si aún no hay sesión.
    if (!authSession?.role) {
      mergeAuthSession({ role: 'admin', canCreateSites: true, canManageAllSites: true, sites: [] })
    }
  }
  applyAuthUi()
  await loadSites()
  await loadPosts()
  await loadSite()
  ensureBodyEditor()
  updateImagePreview()
  login.hidden = true
  app.hidden = false
  if (!location.hash || location.hash === '#/' || location.hash === '#') {
    history.replaceState({ view: 'entradas' }, '', '#/entradas')
  }
  const route = parseHash()
  if (route.view === 'entrada' && route.slug) {
    const post = cachedPosts.find((p) => p.slug === route.slug)
    if (post) {
      fillFormFields(post)
      applyRoute(route)
      return
    }
  }
  if (route.view === 'entrada' && route.isNew) {
    resetFormFields()
    applyRoute(route)
    return
  }
  navigate(route.view === 'entradas' ? { view: 'entradas' } : route, { replace: true })
}

function applyAuthUi() {
  const isAdmin = isSuperAdminSession()
  const allowCreate = canCreateSites()
  const startBtn = document.getElementById('startNewSite')
  const accessCard = document.getElementById('siteAccessCard')
  const webhookLabel = document.querySelector('label[for="siteWebhook"]')
  const siteListDesc = document.querySelector('#siteListCard .card-desc')

  if (authRoleBadge) {
    if (isAdmin) {
      authRoleBadge.dataset.role = 'admin'
      authRoleBadge.textContent = 'Super-admin'
    } else {
      const handle = authSession?.site || authSession?.sites?.[0] || 'este proyecto'
      authRoleBadge.dataset.role = 'site'
      authRoleBadge.textContent = `Acceso al sitio ${handle}`
    }
  }

  if (startBtn) {
    startBtn.hidden = !allowCreate
  }
  if (accessCard) accessCard.hidden = !isAdmin
  if (siteListDesc) {
    siteListDesc.textContent = allowCreate
      ? 'Cada landing tiene su handle, dominio y webhook de Coolify.'
      : `Tu token solo gestiona ${authSession?.site || 'este sitio'}. Para crear sitios nuevos usa el token de super-admin.`
  }
  if (siteFilter) siteFilter.disabled = !isAdmin && (authSession?.sites?.length || 0) <= 1
  // Config avanzada solo admin
  ;['siteWebhook', 'siteCoolifyToken', 'siteHumanApproval', 'testRebuild', 'saveSite'].forEach((id) => {
    const el = document.getElementById(id)
    if (!el) return
    if (id === 'saveSite') {
      el.hidden = !isAdmin
      return
    }
    if (id === 'testRebuild') {
      el.hidden = !isAdmin
      return
    }
    el.disabled = !isAdmin
  })
  document.querySelectorAll('#siteConfigCard .help-callout').forEach((el) => {
    el.hidden = !isAdmin
  })
  if (webhookLabel) webhookLabel.hidden = !isAdmin
  if (siteWebhook) siteWebhook.hidden = !isAdmin
  if (siteCoolifyToken) {
    siteCoolifyToken.hidden = !isAdmin
    const lab = document.querySelector('label[for="siteCoolifyToken"]')
    if (lab) lab.hidden = !isAdmin
  }
  if (siteTokenStatus) siteTokenStatus.hidden = !isAdmin
  if (siteHumanApproval) {
    siteHumanApproval.closest('.checkbox-row')?.classList.toggle('is-hidden', !isAdmin)
  }
}

function showLoginError(message) {
  if (!message) {
    loginError.hidden = true
    loginError.textContent = ''
    return
  }
  loginError.hidden = false
  loginError.textContent = message
}

async function doLogin() {
  const value = tokenInput.value.trim()
  if (!value) {
    showLoginError('Escribe el token de administración.')
    tokenInput.focus()
    return
  }

  showLoginError('')
  enterBtn.disabled = true

  try {
    token = value
    const data = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    }).then(async (res) => {
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.message || 'Token incorrecto')
      return payload
    })

    mergeAuthSession({
      role: data.role || 'admin',
      site: data.site || null,
      sites: data.sites || [],
      canCreateSites: Boolean(data.canCreateSites),
      canManageAllSites: Boolean(data.canManageAllSites)
    })
    if (data.role === 'site' && data.site) {
      localStorage.setItem('escarlet_cms_site', data.site)
      if (siteFilter) siteFilter.dataset.pending = data.site
    }
    localStorage.setItem('escarlet_cms_token', token)
    await afterLogin()
    toast(data.role === 'site' ? `Sesión del sitio ${data.site}` : 'Sesión de super-admin')
  } catch (err) {
    token = ''
    localStorage.removeItem('escarlet_cms_token')
    login.hidden = false
    app.hidden = true
    showLoginError(err.message || 'No se pudo iniciar sesión.')
  } finally {
    enterBtn.disabled = false
  }
}

enterBtn.addEventListener('click', doLogin)
tokenInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    doLogin()
  }
})

document.getElementById('logout').onclick = () => {
  token = ''
  authSession = { role: 'admin', canCreateSites: true, canManageAllSites: true, sites: [] }
  localStorage.removeItem('escarlet_cms_token')
  login.hidden = false
  app.hidden = true
  tokenInput.value = ''
  showLoginError('')
  history.replaceState({ view: 'login' }, '', '#/')
}

if (token) {
  tokenInput.value = token
  doLogin().catch(() => {
    login.hidden = false
    app.hidden = true
  })
}

window.addEventListener('popstate', () => {
  if (app.hidden) return
  const hash = (location.hash || '').replace(/^#\/?/, '').trim()
  if (!hash) {
    navigate({ view: 'entradas' }, { replace: true })
    return
  }
  const route = parseHash()
  if (route.view === 'entrada' && route.slug) {
    const post = cachedPosts.find((p) => p.slug === route.slug)
    if (post && editingOriginalSlug !== route.slug) fillFormFields(post)
  }
  applyRoute(route)
})

window.addEventListener('hashchange', () => {
  if (navigating || app.hidden) return
  applyRoute(parseHash())
})

document.querySelectorAll('.nav-btn[data-route]').forEach((btn) => {
  btn.onclick = () => navigate({ view: btn.dataset.route })
})

document.querySelectorAll('.step-btn').forEach((btn) => {
  btn.onclick = () => goToStep(btn.dataset.step)
})

document.getElementById('backToList')?.addEventListener('click', () => {
  navigate({ view: 'entradas' })
})

document.getElementById('goToPortada')?.addEventListener('click', () => goToStep('portada'))
document.getElementById('goToEscribir')?.addEventListener('click', () => goToStep('escribir'))
document.getElementById('goToRevisar')?.addEventListener('click', async () => {
  const saved = await persistPost({ busyBtn: document.getElementById('goToRevisar') })
  if (saved) goToStep('revisar')
})
document.getElementById('goBackPortada')?.addEventListener('click', () => goToStep('portada'))
document.getElementById('savePortada')?.addEventListener('click', () => persistPost({ busyBtn: document.getElementById('savePortada') }))

menuToggle?.addEventListener('click', () => {
  if (sidebar?.classList.contains('open')) closeSidebar()
  else openSidebar()
})
sidebarBackdrop?.addEventListener('click', closeSidebar)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebar?.classList.contains('open')) {
    closeSidebar()
  }
  if (e.key === 'Escape' && !document.getElementById('mediaLightbox')?.hidden) {
    closeMediaLightbox()
  }
})

async function loadPosts() {
  const site = siteFilter.value.trim() || 'escarlet'
  const status = statusFilter.value
  const q = new URLSearchParams({ site })
  if (status) q.set('status', status)
  list.innerHTML = '<li class="empty">Cargando entradas…</li>'
  const data = await api('/api/admin/posts?' + q)
  list.innerHTML = ''
  const posts = data.posts || []
  cachedPosts = posts
  if (!posts.length) {
    const empty = document.createElement('li')
    empty.className = 'empty empty-cta'
    if (status) {
      empty.innerHTML = `<p>Ninguna entrada en este estado.</p><button type="button" class="btn" id="clearFilter">Ver todas</button>`
      list.appendChild(empty)
      document.getElementById('clearFilter')?.addEventListener('click', () => {
        statusFilter.value = ''
        loadPosts()
      })
    } else {
      empty.innerHTML = `<p>Todavía no hay borradores.</p><button type="button" class="btn btn-primary" id="emptyNew">Nuevo borrador</button>`
      list.appendChild(empty)
      document.getElementById('emptyNew')?.addEventListener('click', () => openPostWorkspace(null, 'escribir'))
    }
    return
  }
  for (const p of posts) {
    const li = document.createElement('li')
    li.className = 'post-item'
    const statusHint =
      p.status === 'review'
        ? '<div class="post-meta">Pendiente de publicar en vivo</div>'
        : ''
    const main = document.createElement('div')
    main.className = 'post-item-main'
    main.innerHTML = `<div><strong>${escapeHtml(p.title)}</strong><span class="badge ${p.status}">${statusLabel(p.status)}</span><div class="post-meta">${escapeHtml(p.slug)}</div>${statusHint}</div>`
    main.style.cursor = 'pointer'
    main.onclick = () => openPostWorkspace(p, 'escribir')

    const actions = document.createElement('div')
    actions.className = 'actions post-actions'
    const edit = document.createElement('button')
    edit.className = 'btn btn-sm btn-ghost'
    edit.innerHTML = ICONS.editor + ' Abrir'
    edit.onclick = (e) => { e.stopPropagation(); openPostWorkspace(p, 'escribir') }

    if (p.status === 'review' || p.status === 'draft') {
      const pub = document.createElement('button')
      pub.className = 'btn btn-sm'
      pub.textContent = p.status === 'review' ? 'Publicar' : 'A revisión'
      pub.onclick = (e) => { e.stopPropagation(); publishSlug(p.slug) }
      actions.append(edit, pub)
    } else {
      actions.append(edit)
    }

    const moreWrap = document.createElement('div')
    moreWrap.className = 'more-menu'
    const moreBtn = document.createElement('button')
    moreBtn.type = 'button'
    moreBtn.className = 'btn btn-sm'
    moreBtn.setAttribute('aria-label', 'Más acciones')
    moreBtn.innerHTML = ICONS.more
    const menu = document.createElement('div')
    menu.className = 'more-menu-panel'
    menu.hidden = true

    const prevItem = document.createElement('button')
    prevItem.type = 'button'
    prevItem.className = 'more-item'
    prevItem.textContent = 'Revisar'
    prevItem.onclick = (e) => {
      e.stopPropagation()
      menu.hidden = true
      openPostWorkspace(p, 'revisar')
    }
    menu.appendChild(prevItem)

    if (p.status === 'published') {
      const unpub = document.createElement('button')
      unpub.type = 'button'
      unpub.className = 'more-item'
      unpub.textContent = 'Despublicar'
      unpub.onclick = (e) => {
        e.stopPropagation()
        menu.hidden = true
        unpublishSlug(p.slug)
      }
      menu.appendChild(unpub)
    }

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'more-item more-item-danger'
    del.textContent = 'Eliminar'
    del.onclick = (e) => {
      e.stopPropagation()
      menu.hidden = true
      deleteSlug(p.slug)
    }
    menu.appendChild(del)

    moreBtn.onclick = (e) => {
      e.stopPropagation()
      const open = menu.hidden
      document.querySelectorAll('.more-menu-panel').forEach((m) => { m.hidden = true })
      menu.hidden = !open
    }
    moreWrap.append(moreBtn, menu)
    actions.append(moreWrap)

    li.append(main, actions)
    list.appendChild(li)
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

document.addEventListener('click', () => {
  document.querySelectorAll('.more-menu-panel').forEach((m) => { m.hidden = true })
})

function syncEditorLifecycleButtons(status) {
  const unpublishBtn = document.getElementById('unpublishPost')
  const deleteBtn = document.getElementById('deletePost')
  const hasPost = Boolean(editingOriginalSlug || form.slug.value.trim())
  if (unpublishBtn) unpublishBtn.hidden = !(hasPost && status === 'published')
  if (deleteBtn) deleteBtn.hidden = !hasPost
}

document.getElementById('unpublishPost')?.addEventListener('click', () => {
  const slug = editingOriginalSlug || form.slug.value.trim()
  unpublishSlug(slug)
})

document.getElementById('deletePost')?.addEventListener('click', () => {
  const slug = editingOriginalSlug || form.slug.value.trim()
  deleteSlug(slug)
})

document.getElementById('reloadPosts').onclick = () => loadPosts().catch((e) => toast(e.message))
statusFilter.onchange = () => loadPosts().catch((e) => toast(e.message))
form.imageUrl.addEventListener('input', updateImagePreview)
form.title?.addEventListener('input', () => {
  if (workspaceTitle) workspaceTitle.textContent = form.title.value.trim() || 'Nueva entrada'
})

document.getElementById('loadPreview').onclick = () => {
  const slug = editingOriginalSlug || form.slug.value.trim()
  showPreviewForSlug(slug)
}
document.getElementById('openPreviewTab').onclick = () => {
  const slug = editingOriginalSlug || form.slug.value.trim()
  showPreviewForSlug(slug, { newTab: true })
}

async function publishSlug(slug) {
  const site = siteFilter.value.trim() || 'escarlet'
  const btn = publishPostBtn
  try {
    const data = await withBusy(btn, 'Publicando…', () =>
      api('/api/admin/posts/publish', {
        method: 'POST',
        body: JSON.stringify({ site, slug })
      })
    )
    const msg = data.submittedForReview
      ? (data.message ||
        'Enviado a revisión. En Entradas aparece como En revisión. Cuando esté listo, pulsa Publicar en vivo.')
      : data.rebuild
        ? (data.rebuild.ok
          ? 'Publicado en vivo. Rebuild del sitio disparado.'
          : `Publicado en vivo. El rebuild falló. ${data.rebuild.message || ''}`)
        : (data.message || 'Publicado en vivo')
    toast(msg, { sticky: Boolean(data.submittedForReview), duration: data.submittedForReview ? 0 : 12000 })
    if (currentStep === 'revisar') {
      showPublishBanner(msg, data.submittedForReview ? 'review' : data.published ? 'ok' : 'info')
    }
    await loadPosts()
    const updated = cachedPosts.find((p) => p.slug === slug)
    if (updated) {
      postStatusInput.value = updated.status
      updateWorkspaceChrome()
      if (editingOriginalSlug === slug || form.slug.value === slug) {
        // keep form in sync
      }
    }
    if (currentStep === 'revisar' || currentRoute.view === 'entrada') showPreviewForSlug(slug)
    return data
  } catch (err) {
    toast(err.message, { duration: 12000 })
    if (currentStep === 'revisar') showPublishBanner(err.message, 'error')
    throw err
  }
}

async function unpublishSlug(slug) {
  if (!slug) return toast('Falta el slug de la entrada')
  if (!confirm(`¿Despublicar «${slug}»? Pasará a borrador y saldrá del blog.`)) return
  const site = siteFilter.value.trim() || 'escarlet'
  try {
    const data = await api('/api/admin/posts/unpublish', {
      method: 'POST',
      body: JSON.stringify({ site, slug })
    })
    toast(data.message || 'Entrada despublicada')
    await loadPosts()
    if (editingOriginalSlug === slug || form.slug.value === slug) {
      postStatusInput.value = 'draft'
      updateWorkspaceChrome()
    }
  } catch (err) {
    toast(err.message)
  }
}

async function deleteSlug(slug) {
  if (!slug) return toast('Falta el slug de la entrada')
  if (!confirm(`¿Eliminar permanentemente «${slug}»? Si estaba publicado, también se pedirá rebuild del sitio.`)) return
  const site = siteFilter.value.trim() || 'escarlet'
  try {
    const data = await api(`/api/admin/posts/${encodeURIComponent(slug)}?site=${encodeURIComponent(site)}`, {
      method: 'DELETE'
    })
    const rebuildFailed = data.rebuild && !data.rebuild.ok
    toast(data.message || 'Entrada eliminada', {
      sticky: Boolean(rebuildFailed),
      duration: rebuildFailed ? 0 : 12000
    })
    if (editingOriginalSlug === slug || form.slug.value === slug) {
      navigate({ view: 'entradas' }, { replace: true })
      resetFormFields()
    }
    await loadPosts()
  } catch (err) {
    toast(err.message)
  }
}

document.getElementById('newPost').onclick = () => openPostWorkspace(null, 'escribir')

async function persistPost({ busyBtn } = {}) {
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  const title = form.title.value.trim()
  if (!slug || !title) {
    toast('Faltan título y slug. Guarda el paso Escribir primero.')
    return false
  }

  const run = async () => {
    if (!editingOriginalSlug) {
      try {
        await api('/api/admin/posts/create-draft', {
          method: 'POST',
          body: JSON.stringify({
            site,
            title,
            slug,
            author: form.authorName.value.trim() || 'Silvia',
            date: form.datePublished.value || undefined
          })
        })
        editingOriginalSlug = slug
      } catch (err) {
        if (!/Ya existe slug/i.test(err.message || '')) {
          toast(err.message)
          return false
        }
        editingOriginalSlug = slug
      }
    }

    const slides = parseInstagramSlides(form.instagramSlides?.value)
    if (slides === null) {
      toast('El JSON de slides de Instagram no es válido')
      return false
    }

    const payload = {
      site,
      slug,
      originalSlug: editingOriginalSlug || slug,
      keepPublished: postStatusInput.value === 'published',
      title,
      authorName: form.authorName.value.trim(),
      status: postStatusInput.value,
      datePublished: form.datePublished.value,
      dateModified: form.dateModified.value,
      metaTitle: { es: form.metaTitleEs.value.trim(), en: form.metaTitleEs.value.trim() },
      metaDescription: { es: form.metaDescriptionEs.value.trim(), en: form.metaDescriptionEs.value.trim() },
      excerptEs: form.excerptEs.value.trim(),
      imageUrl: form.imageUrl.value.trim(),
      imageAlt: form.imageAlt.value.trim(),
      relatedSlugs: form.relatedSlugs.value.split(',').map((s) => s.trim()).filter(Boolean),
      socialPack: {
        substackTitle: form.substackTitle.value.trim(),
        substackBody: form.substackBody.value.trim(),
        linkedin: form.linkedin.value.trim(),
        x: form.x.value.trim(),
        videoScript: form.videoScript?.value.trim() || '',
        instagramCaption: form.instagramCaption?.value.trim() || '',
        instagramSlides: slides
      },
      bodyHtml: bodyValue()
    }
    const data = await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(payload) })
    editingOriginalSlug = slug
    await loadPosts()
    updateWorkspaceChrome()
    renderCarouselStrip()
    navigate({
      view: 'entrada',
      slug,
      isNew: false,
      step: currentStep
    }, { replace: true })
    const msg = rebuildSaveMessage(data)
    toast(msg.text, { sticky: msg.sticky, duration: msg.sticky ? 0 : 12000 })
    if (currentStep === 'revisar') {
      showPublishBanner(msg.text, data.rebuild?.ok === false ? 'error' : 'ok')
    }
    return data
  }

  try {
    if (busyBtn) return await withBusy(busyBtn, 'Guardando…', run)
    return await run()
  } catch (err) {
    toast(err.message, { duration: 12000 })
    return false
  }
}

form.onsubmit = async (e) => {
  e.preventDefault()
  await persistPost({ busyBtn: document.getElementById('savePost') })
}

document.getElementById('validateSeo').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  if (!slug) return toast('Guarda la entrada con un slug antes de validar SEO')
  const data = await api('/api/admin/validate-seo', { method: 'POST', body: JSON.stringify({ site, slug }) })
  seoResult.hidden = false
  const parts = []
  parts.push(`<p class="seo-summary ${data.ok ? 'is-ok' : 'is-error'}">${data.ok ? 'Listo para publicar.' : 'Hay bloqueos SEO.'} Palabras: ${data.wordCount ?? '?'}</p>`)
  if (data.errors?.length) {
    parts.push('<ul class="seo-list seo-errors">')
    data.errors.forEach((e) => parts.push(`<li>${escapeHtml(e)}</li>`))
    parts.push('</ul>')
  }
  if (data.warnings?.length) {
    parts.push('<ul class="seo-list seo-warnings">')
    data.warnings.forEach((w) => parts.push(`<li>${escapeHtml(w)}</li>`))
    parts.push('</ul>')
  }
  seoResult.innerHTML = parts.join('')
}

document.getElementById('publishPost').onclick = async () => {
  const slug = form.slug.value.trim() || editingOriginalSlug
  if (!slug) return toast('Guarda la entrada con un slug antes de publicar')
  try {
    await publishSlug(slug)
  } catch {
    /* toast ya mostrado */
  }
}

async function loadMedia() {
  const site = siteFilter.value.trim() || 'escarlet'
  const kind = document.getElementById('portadaMediaFilter')?.value || ''
  const q = new URLSearchParams({ site })
  if (kind) q.set('kind', kind)
  const data = await api('/api/admin/media?' + q)
  renderMediaGrid(mediaGrid, data.media || [], { allowUse: true })
  renderCarouselStrip()
}

async function loadLibrary() {
  if (!libraryGrid) return
  const site = siteFilter.value.trim() || 'escarlet'
  const kind = libraryKindFilter?.value || ''
  const q = new URLSearchParams({ site })
  if (kind) q.set('kind', kind)
  const data = await api('/api/admin/media?' + q)
  renderMediaGrid(libraryGrid, data.media || [], { allowUse: false })
}

document.getElementById('uploadForm').onsubmit = async (e) => {
  e.preventDefault()
  const file = document.getElementById('uploadFile').files[0]
  if (!file) return toast('Elige un archivo de imagen')
  const btn = document.getElementById('uploadBtn')
  await withBusy(btn, 'Subiendo…', async () => {
    const site = siteFilter.value.trim() || 'escarlet'
    const kind = document.getElementById('uploadKind').value
    const data = await api('/api/admin/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        site,
        filename: file.name,
        contentBase64: await fileToBase64(file),
        alt: document.getElementById('uploadAlt').value,
        kind
      })
    })
    document.getElementById('uploadFile').value = ''
    if (data.media && kind === 'post') {
      applyImageToPost(data.media)
    } else if (data.media && kind === 'social') {
      addImageToCarousel(data.media)
    } else {
      toast('Imagen subida')
      await loadMedia()
    }
    if (currentRoute?.view === 'media') await loadLibrary()
  })
}

libraryKindFilter?.addEventListener('change', () => {
  loadLibrary().catch((e) => toast(e.message))
})

document.getElementById('portadaMediaFilter')?.addEventListener('change', () => {
  loadMedia().catch((e) => toast(e.message))
})

document.getElementById('libraryUploadForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const file = document.getElementById('libraryFile')?.files?.[0]
  if (!file) return toast('Elige un archivo de imagen')
  const btn = document.getElementById('libraryUploadBtn')
  await withBusy(btn, 'Subiendo…', async () => {
    const site = siteFilter.value.trim() || 'escarlet'
    await api('/api/admin/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        site,
        filename: file.name,
        contentBase64: await fileToBase64(file),
        alt: document.getElementById('libraryAlt')?.value || '',
        kind: document.getElementById('libraryKind')?.value || 'post'
      })
    })
    document.getElementById('libraryFile').value = ''
    await loadLibrary()
    toast('Imagen subida al archivo')
  })
})

document.getElementById('mediaLightboxClose')?.addEventListener('click', closeMediaLightbox)
document.getElementById('mediaLightbox')?.addEventListener('click', (event) => {
  if (event.target.id === 'mediaLightbox') closeMediaLightbox()
})

async function loadBrand() {
  const site = siteFilter.value.trim() || 'escarlet'
  const file = brandFile.value
  const data = await api(`/api/admin/brand-kit/${site}/${file}`)
  setBrandValue(data.content || '')
}

brandFile.onchange = () => loadBrand().catch((e) => toast(e.message))
document.getElementById('saveBrand').onclick = async () => {
  const btn = document.getElementById('saveBrand')
  await withBusy(btn, 'Guardando…', async () => {
    const site = siteFilter.value.trim() || 'escarlet'
    const file = brandFile.value
    await api(`/api/admin/brand-kit/${site}/${encodeURIComponent(file)}`, {
      method: 'POST',
      body: JSON.stringify({ content: brandValue() })
    })
    toast('Kit de marca guardado')
  })
}

async function loadRefs() {
  const site = siteFilter.value.trim() || 'escarlet'
  const data = await api('/api/admin/media?site=' + site + '&kind=reference')
  renderMediaGrid(refGrid, data.media || [], { allowUse: false })
}

document.getElementById('refUploadForm').onsubmit = async (e) => {
  e.preventDefault()
  const file = document.getElementById('refFile').files[0]
  if (!file) return toast('Elige un archivo')
  const btn = document.getElementById('refUploadBtn')
  await withBusy(btn, 'Subiendo…', async () => {
    const site = siteFilter.value.trim() || 'escarlet'
    await api('/api/admin/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        site,
        filename: file.name,
        contentBase64: await fileToBase64(file),
        alt: document.getElementById('refAlt').value,
        kind: 'reference'
      })
    })
    document.getElementById('refFile').value = ''
    await loadRefs()
    toast('Referencia subida')
  })
}

async function loadSites() {
  const data = await api('/api/admin/sites')
  if (data.role || typeof data.canCreateSites === 'boolean') {
    mergeAuthSession({
      role: data.role || authSession.role,
      site: authSession.site,
      sites: data.handles || authSession.sites,
      canCreateSites:
        typeof data.canCreateSites === 'boolean' ? data.canCreateSites : authSession.canCreateSites,
      canManageAllSites: data.role === 'admin' ? true : authSession.canManageAllSites
    })
    applyAuthUi()
  }
  const fromDb = (data.sites || []).map((s) => s.handle || s.id).filter(Boolean)
  const handles = [...new Set([...(data.handles || []), ...fromDb])].sort()
  cachedSiteHandles = handles.length ? handles : ['escarlet']

  const pending = siteFilter.dataset.pending || localStorage.getItem('escarlet_cms_site') || ''
  const current = siteFilter.value.trim()
  const preferred =
    (pending && cachedSiteHandles.includes(pending) && pending) ||
    (current && cachedSiteHandles.includes(current) && current) ||
    cachedSiteHandles[0]

  delete siteFilter.dataset.pending
  siteFilter.innerHTML = ''
  for (const handle of cachedSiteHandles) {
    const opt = document.createElement('option')
    opt.value = handle
    opt.textContent = handle
    siteFilter.appendChild(opt)
  }
  siteFilter.value = preferred
  activeSiteHandle = preferred
  localStorage.setItem('escarlet_cms_site', preferred)
  if (siteLabel) siteLabel.textContent = preferred
  renderSiteList()
}

function renderSiteList() {
  if (!siteList) return
  const active = siteFilter.value.trim()
  if (!cachedSiteHandles.length) {
    siteList.innerHTML = '<li class="muted">Aún no hay sitios. Crea el primero con Nuevo sitio.</li>'
    return
  }
  siteList.innerHTML = cachedSiteHandles
    .map((handle) => {
      const isActive = handle === active
      return `<li class="site-list-item${isActive ? ' is-active' : ''}">
        <div class="site-list-meta">
          <strong>${escapeHtml(handle)}</strong>
          <span>${isActive ? 'Sitio activo ahora' : 'Clic para activar'}</span>
        </div>
        <button type="button" class="btn ${isActive ? '' : 'btn-primary'}" data-activate-site="${escapeHtml(handle)}" ${isActive ? 'disabled' : ''}>
          ${isActive ? 'Activo' : 'Usar'}
        </button>
      </li>`
    })
    .join('')
  siteList.querySelectorAll('[data-activate-site]').forEach((btn) => {
    btn.onclick = () => switchSite(btn.getAttribute('data-activate-site'))
  })
}

async function switchSite(handle) {
  if (!handle) return
  const changing = handle !== activeSiteHandle
  siteFilter.value = handle
  activeSiteHandle = handle
  localStorage.setItem('escarlet_cms_site', handle)
  if (siteLabel) siteLabel.textContent = handle
  renderSiteList()
  if (!changing) return
  hideOnboard()
  await loadPosts()
  await loadSite()
  if (currentRoute?.view === 'marca') {
    await loadBrand()
    await loadRefs()
  }
  if (currentRoute?.view === 'media') {
    await loadLibrary()
  }
  toast(`Sitio activo. ${handle}`)
}

siteFilter.onchange = () => {
  switchSite(siteFilter.value.trim()).catch((e) => toast(e.message))
}

function showOnboard() {
  if (siteOnboardCard) siteOnboardCard.hidden = false
  if (siteListCard) siteListCard.hidden = true
  if (siteConfigCard) siteConfigCard.hidden = true
  resetOnboardForm()
  setOnboardStep('basics')
  if (onboardDone) onboardDone.hidden = true
  document.getElementById('createSiteBtn').hidden = false
  document.getElementById('onboardBackCoolify').hidden = false
}

function hideOnboard() {
  if (siteOnboardCard) siteOnboardCard.hidden = true
  if (siteListCard) siteListCard.hidden = false
  if (siteConfigCard) siteConfigCard.hidden = false
}

function resetOnboardForm() {
  const handle = document.getElementById('newSiteHandle')
  const name = document.getElementById('newSiteName')
  const domain = document.getElementById('newSiteDomain')
  const authors = document.getElementById('newSiteAuthors')
  const webhook = document.getElementById('newSiteWebhook')
  const tokenEl = document.getElementById('newSiteToken')
  const approval = document.getElementById('newSiteHumanApproval')
  if (handle) handle.value = ''
  if (name) name.value = ''
  if (domain) domain.value = ''
  if (authors) authors.value = ''
  if (webhook) webhook.value = ''
  if (tokenEl) tokenEl.value = ''
  if (approval) approval.checked = true
  if (onboardSummary) onboardSummary.innerHTML = ''
}

function setOnboardStep(step) {
  onboardStep = step
  document.querySelectorAll('[data-onboard-step]').forEach((b) => {
    b.classList.toggle('active', b.dataset.onboardStep === step)
  })
  document.querySelectorAll('.onboard-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'onboard-' + step)
  })
  if (onboardHint) onboardHint.textContent = ONBOARD_HINTS[step] || ''
  if (step === 'review') fillOnboardSummary()
}

function readOnboardPayload() {
  const handle = document.getElementById('newSiteHandle')?.value.trim().toLowerCase() || ''
  const name = document.getElementById('newSiteName')?.value.trim() || handle
  const domain = document.getElementById('newSiteDomain')?.value.trim() || ''
  const authorsRaw = document.getElementById('newSiteAuthors')?.value.trim() || ''
  const authors = authorsRaw
    ? authorsRaw.split(',').map((a) => a.trim()).filter(Boolean)
    : undefined
  const rebuildWebhookUrl = document.getElementById('newSiteWebhook')?.value.trim() || ''
  const coolifyApiToken = document.getElementById('newSiteToken')?.value.trim() || ''
  const requiresHumanApproval = Boolean(document.getElementById('newSiteHumanApproval')?.checked)
  return { handle, name, domain, authors, rebuildWebhookUrl, coolifyApiToken, requiresHumanApproval }
}

function fillOnboardSummary() {
  if (!onboardSummary) return
  const p = readOnboardPayload()
  const rows = [
    ['Handle', p.handle || '—'],
    ['Nombre', p.name || '—'],
    ['Dominio', p.domain || '—'],
    ['Autores', p.authors?.join(', ') || 'Equipo'],
    ['Webhook', p.rebuildWebhookUrl || 'Lo configuras después'],
    ['Token Coolify', p.coolifyApiToken ? 'Se guardará al crear' : 'Lo configuras después'],
    ['Aprobación humana', p.requiresHumanApproval ? 'Sí' : 'Publicación directa']
  ]
  onboardSummary.innerHTML = rows
    .map(
      ([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`
    )
    .join('')
}

function validateOnboardBasics() {
  const p = readOnboardPayload()
  if (!/^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(p.handle)) {
    toast('Handle inválido. Usa kebab-case corto, por ejemplo mares24.')
    return false
  }
  if (!p.domain || !/^https?:\/\//i.test(p.domain)) {
    toast('Dominio con https:// o http://')
    return false
  }
  return true
}

document.getElementById('startNewSite')?.addEventListener('click', () => {
  showOnboard()
})

document.getElementById('cancelNewSite')?.addEventListener('click', () => {
  hideOnboard()
})

document.getElementById('onboardNextCoolify')?.addEventListener('click', () => {
  if (!validateOnboardBasics()) return
  const name = document.getElementById('newSiteName')
  const handle = document.getElementById('newSiteHandle')
  if (name && handle && !name.value.trim()) name.value = handle.value.trim()
  setOnboardStep('coolify')
})

document.getElementById('onboardBackBasics')?.addEventListener('click', () => setOnboardStep('basics'))
document.getElementById('onboardNextReview')?.addEventListener('click', () => setOnboardStep('review'))
document.getElementById('onboardBackCoolify')?.addEventListener('click', () => setOnboardStep('coolify'))

document.querySelectorAll('[data-onboard-step]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const step = btn.dataset.onboardStep
    if (step === 'coolify' || step === 'review') {
      if (!validateOnboardBasics()) return
    }
    setOnboardStep(step)
  })
})

document.getElementById('createSiteBtn')?.addEventListener('click', async () => {
  if (!validateOnboardBasics()) {
    setOnboardStep('basics')
    return
  }
  const btn = document.getElementById('createSiteBtn')
  await withBusy(btn, 'Creando…', async () => {
    const payload = readOnboardPayload()
    if (!payload.rebuildWebhookUrl) delete payload.rebuildWebhookUrl
    if (!payload.coolifyApiToken) delete payload.coolifyApiToken
    if (!payload.authors?.length) delete payload.authors
    await api('/api/admin/sites', { method: 'POST', body: JSON.stringify(payload) })
    await loadSites()
    await switchSite(payload.handle)
    if (onboardDone) onboardDone.hidden = false
    btn.hidden = true
    document.getElementById('onboardBackCoolify').hidden = true
    toast(`Sitio ${payload.handle} creado`)
  })
})

document.getElementById('onboardGoBrand')?.addEventListener('click', () => {
  hideOnboard()
  navigate({ view: 'marca' })
})

document.getElementById('onboardFinish')?.addEventListener('click', () => {
  hideOnboard()
  loadSite().catch((e) => toast(e.message))
})

async function loadSite() {
  const site = siteFilter.value.trim() || 'escarlet'
  if (siteLabel) siteLabel.textContent = site
  renderSiteList()
  applyAuthUi()
  const data = await api(`/api/admin/site-config/${site}`)
  if (siteName) siteName.value = data.config?.name || site
  siteDomain.value = data.config?.domain || ''
  if (siteWebhook) siteWebhook.value = data.config?.rebuildWebhookUrl || ''
  humanApprovalRequired = Boolean(data.config?.requiresHumanApproval)
  if (siteHumanApproval) siteHumanApproval.checked = humanApprovalRequired
  socialPackChannels = normalizeSocialPackChannels(data.config?.socialPackChannels)
  writeChannelCheckboxes(socialPackChannels)
  applySocialPackChannelUi(socialPackChannels)
  if (siteCoolifyToken) siteCoolifyToken.value = ''
  if (siteTokenStatus) {
    siteTokenStatus.textContent = data.config?.hasCoolifyApiToken
      ? `Token Coolify guardado (${data.config.coolifyApiTokenHint}). Deja el campo vacío para mantenerlo.`
      : 'Sin token Coolify todavía.'
  }
  const accessStatus = document.getElementById('siteAccessStatus')
  if (accessStatus) {
    accessStatus.textContent = data.config?.hasSiteAccessToken
      ? `Token de cliente activo (${data.config.siteAccessTokenHint}).`
      : 'Sin token de cliente todavía.'
  }
  resetSiteAccessPanel()
  await loadSiteMcpInfo(site)
  rebuildResult.textContent = ''
  rebuildResult.classList.remove('is-ok', 'is-error')
  setPublishLabels(postStatusInput?.value || 'draft')
}

document.getElementById('saveSite').onclick = async () => {
  const btn = document.getElementById('saveSite')
  await withBusy(btn, 'Guardando…', async () => {
    const site = siteFilter.value.trim() || 'escarlet'
    const payload = {
      name: siteName?.value.trim() || site,
      domain: siteDomain.value.trim(),
      rebuildWebhookUrl: siteWebhook.value.trim(),
      requiresHumanApproval: siteHumanApproval.checked,
      socialPackChannels: readChannelCheckboxes()
    }
    if (siteCoolifyToken.value.trim()) payload.coolifyApiToken = siteCoolifyToken.value.trim()
    const data = await api(`/api/admin/site-config/${site}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    siteCoolifyToken.value = ''
    siteTokenStatus.textContent = data.config?.hasCoolifyApiToken
      ? `Token Coolify guardado (${data.config.coolifyApiTokenHint}). Deja el campo vacío para mantenerlo.`
      : 'Sin token Coolify todavía.'
    socialPackChannels = normalizeSocialPackChannels(data.config?.socialPackChannels)
    writeChannelCheckboxes(socialPackChannels)
    applySocialPackChannelUi(socialPackChannels)
    toast('Sitio guardado')
    humanApprovalRequired = Boolean(siteHumanApproval.checked)
    setPublishLabels(postStatusInput?.value || 'draft')
  })
}

document.getElementById('testRebuild').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  rebuildResult.classList.remove('is-ok', 'is-error')
  rebuildResult.textContent = 'Probando webhook…'
  try {
    const data = await api(`/api/admin/site-config/${site}/test-rebuild`, { method: 'POST', body: '{}' })
    showRebuildResult(data.rebuild, 'Webhook respondió sin detalle')
  } catch (err) {
    showRebuildResult(err.payload?.rebuild, err.message || 'No se pudo probar el webhook')
  }
}

document.getElementById('generateSiteToken')?.addEventListener('click', async () => {
  const btn = document.getElementById('generateSiteToken')
  const site = siteFilter.value.trim() || 'escarlet'
  await withBusy(btn, 'Generando…', async () => {
    const data = await api(`/api/admin/site-config/${site}/access-token`, {
      method: 'POST',
      body: '{}'
    })
    renderSiteAccessSuccess(data)
    const accessStatus = document.getElementById('siteAccessStatus')
    if (accessStatus) {
      accessStatus.textContent = data.config?.hasSiteAccessToken
        ? `Token de cliente activo (${data.config.siteAccessTokenHint}).`
        : 'Token generado.'
    }
    toast('Copia el token ahora. Solo se muestra una vez.')
  })
})

document.getElementById('clearSiteToken')?.addEventListener('click', async () => {
  const btn = document.getElementById('clearSiteToken')
  const site = siteFilter.value.trim() || 'escarlet'
  if (!window.confirm('¿Revocar el token de cliente de este sitio?')) return
  await withBusy(btn, 'Revocando…', async () => {
    await api(`/api/admin/site-config/${site}/access-token`, {
      method: 'POST',
      body: JSON.stringify({ clear: true })
    })
    resetSiteAccessPanel()
    const accessStatus = document.getElementById('siteAccessStatus')
    if (accessStatus) accessStatus.textContent = 'Sin token de cliente todavía.'
    toast('Token de cliente revocado')
  })
})

function resetSiteAccessPanel() {
  const panel = document.getElementById('siteAccessResult')
  if (panel) panel.hidden = true
  const tokenEl = document.getElementById('siteAccessTokenValue')
  if (tokenEl) tokenEl.textContent = ''
  const iconStatus = document.getElementById('siteAgentIconStatus')
  if (iconStatus) iconStatus.textContent = ''
  const preview = document.getElementById('siteAgentIconPreview')
  if (preview) {
    preview.hidden = true
    preview.removeAttribute('src')
  }
  const link = document.getElementById('siteAgentIconLink')
  if (link) {
    link.hidden = true
    link.removeAttribute('href')
  }
}

function renderAgentIconInfo(agentIcon) {
  const status = document.getElementById('siteAgentIconStatus')
  const preview = document.getElementById('siteAgentIconPreview')
  const link = document.getElementById('siteAgentIconLink')
  if (!status) return
  if (!agentIcon) {
    status.textContent = 'Icono no disponible todavía.'
    return
  }
  if (agentIcon.ok) {
    const kb = ((agentIcon.bytes || 0) / 1024).toFixed(1)
    status.textContent = agentIcon.reused
      ? `Icono listo (${kb} KB). Puedes usarlo en el conector de ChatGPT o Claude.`
      : `Icono generado desde el favicon (${kb} KB).`
    if (preview && agentIcon.path) {
      preview.hidden = false
      preview.src = `${agentIcon.path}?t=${Date.now()}`
    }
    if (link && (agentIcon.url || agentIcon.path)) {
      link.hidden = false
      link.href = agentIcon.url || agentIcon.path
      link.download = 'agent-icon.png'
    }
  } else {
    status.textContent =
      agentIcon.message ||
      'No se pudo obtener el favicon. El token sigue siendo válido. Puedes subir un PNG pequeño a mano.'
    if (preview) preview.hidden = true
    if (link) link.hidden = true
  }
}

function renderSiteAccessSuccess(data) {
  const panel = document.getElementById('siteAccessResult')
  if (panel) panel.hidden = false
  const tokenEl = document.getElementById('siteAccessTokenValue')
  if (tokenEl) tokenEl.textContent = data.siteAccessToken || ''
  const mcpUrl = data.mcpChatGptUrl || data.mcpUrl || ''
  const mcpEl = document.getElementById('siteMcpUrl')
  if (mcpEl) mcpEl.textContent = mcpUrl
  const hintEl = document.getElementById('siteMcpHint')
  if (hintEl) hintEl.textContent = [data.mcpAuthHint, data.mcpClaudeHint].filter(Boolean).join(' ')
  const staticUrl = document.getElementById('siteMcpStaticUrl')
  if (staticUrl && mcpUrl) staticUrl.textContent = mcpUrl
  renderAgentIconInfo(data.agentIcon)
}

async function loadSiteMcpInfo(site) {
  try {
    const data = await api(`/api/admin/site-config/${encodeURIComponent(site)}/agent-icon`)
    const mcpUrl = data.mcpChatGptUrl || data.mcpUrl || ''
    const staticUrl = document.getElementById('siteMcpStaticUrl')
    if (staticUrl && mcpUrl) staticUrl.textContent = mcpUrl
  } catch {
    const staticUrl = document.getElementById('siteMcpStaticUrl')
    if (staticUrl) staticUrl.textContent = 'https://blog-cms.escarlet.cc/mcp'
  }
}

document.getElementById('brandZipForm')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const file = document.getElementById('brandZipFile')?.files?.[0]
  if (!file) {
    toast('Elige un archivo ZIP')
    return
  }
  const btn = document.getElementById('brandZipBtn')
  const site = siteFilter.value.trim() || 'escarlet'
  await withBusy(btn, 'Importando…', async () => {
    const contentBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('No se pudo leer el ZIP'))
      reader.readAsDataURL(file)
    })
    const data = await api(`/api/admin/brand-kit/${encodeURIComponent(site)}/import-zip`, {
      method: 'POST',
      body: JSON.stringify({ contentBase64 })
    })
    const out = document.getElementById('brandZipResult')
    if (out) {
      out.hidden = false
      out.textContent = [
        `MD importados. ${(data.importedMd || []).join(', ') || 'ninguno'}`,
        data.importedData?.length ? `JSON. ${data.importedData.join(', ')}` : '',
        `Imágenes. ${(data.importedImages || []).length}`,
        data.skipped?.length ? `Omitidos. ${data.skipped.slice(0, 8).join(', ')}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    }
    document.getElementById('brandZipFile').value = ''
    await loadBrand()
    await loadRefs()
    toast('Brand kit importado')
  })
})
