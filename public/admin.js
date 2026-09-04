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
  escribir: 'Paso 1 de 3. Escribe. El navegador guarda solo. Un Guardar envía todo al CMS.',
  portada: 'Paso 2 de 3. La portada es el artículo. El carrusel es Instagram. El recuadro elige portada. El más mete la slide.',
  revisar: 'Paso 3 de 3. La vista previa lee el CMS. Guardar primero. Publicar actualiza la web.'
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
let skipLocalSave = false
let localDirty = false
let localSaveTimer = null
let lastSavedFingerprint = ''
const LOCAL_DRAFT_PREFIX = 'escarlet_cms_local_draft:'
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

function currentSite() {
  return siteFilter?.value.trim() || 'escarlet'
}

function localDraftStorageKey(site, slug) {
  return `${LOCAL_DRAFT_PREFIX}${site}:${slug || '__new__'}`
}

function listLocalDrafts(site = currentSite()) {
  const prefix = `${LOCAL_DRAFT_PREFIX}${site}:`
  const out = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(prefix)) continue
    try {
      const draft = JSON.parse(localStorage.getItem(key) || '')
      if (!draft || typeof draft !== 'object') continue
      out.push({ key, slug: key.slice(prefix.length), draft })
    } catch {
      /* clave rota */
    }
  }
  return out.sort((a, b) => (b.draft.savedAt || 0) - (a.draft.savedAt || 0))
}

function readLocalDraft(site, slug) {
  try {
    const raw = localStorage.getItem(localDraftStorageKey(site, slug))
    if (!raw) return null
    const draft = JSON.parse(raw)
    return draft && typeof draft === 'object' ? draft : null
  } catch {
    return null
  }
}

function clearLocalDraft(site, slug) {
  localStorage.removeItem(localDraftStorageKey(site, slug))
  if (slug && slug !== '__new__') localStorage.removeItem(localDraftStorageKey(site, '__new__'))
}

function collectFormState() {
  const visibleCaption = document.getElementById('fieldInstagramCaptionVisible')
  return {
    title: form.title.value,
    slug: form.slug.value,
    originalSlug: editingOriginalSlug || '',
    authorName: form.authorName.value,
    status: postStatusInput.value,
    datePublished: form.datePublished.value,
    dateModified: form.dateModified.value,
    metaTitleEs: form.metaTitleEs.value,
    metaDescriptionEs: form.metaDescriptionEs.value,
    excerptEs: form.excerptEs.value,
    imageUrl: form.imageUrl.value,
    imageAlt: form.imageAlt.value,
    relatedSlugs: form.relatedSlugs.value,
    substackTitle: form.substackTitle.value,
    substackBody: form.substackBody.value,
    linkedin: form.linkedin.value,
    x: form.x.value,
    videoScript: form.videoScript?.value || '',
    instagramCaption: form.instagramCaption?.value || visibleCaption?.value || '',
    instagramSlides: form.instagramSlides?.value || '',
    bodyHtml: bodyValue()
  }
}

function stateFingerprint(state) {
  const slides = parseInstagramSlides(state?.instagramSlides)
  return JSON.stringify({
    title: String(state?.title || '').trim(),
    slug: String(state?.slug || '').trim(),
    excerptEs: String(state?.excerptEs || '').trim(),
    imageUrl: String(state?.imageUrl || '').trim(),
    imageAlt: String(state?.imageAlt || '').trim(),
    instagramCaption: String(state?.instagramCaption || '').trim(),
    instagramSlides: slides || [],
    bodyHtml: String(state?.bodyHtml || '').replace(/\s+/g, ' ').trim()
  })
}

function rememberSavedState(state = collectFormState()) {
  lastSavedFingerprint = stateFingerprint(state)
}

function isSameAsSaved(state = collectFormState()) {
  return Boolean(lastSavedFingerprint) && stateFingerprint(state) === lastSavedFingerprint
}

function normalizeSlidesForCompare(slides) {
  return (Array.isArray(slides) ? slides : []).map((slide) => ({
    imageUrl: String(slide?.imageUrl || '').trim(),
    alt: String(slide?.alt || '').trim(),
    headline: String(slide?.headline || '').trim(),
    body: String(slide?.body || '').trim()
  }))
}

function draftLooksSaved(draft, post) {
  if (!draft || !post) return false
  const slides = normalizeSlidesForCompare(parseInstagramSlides(draft.instagramSlides) || [])
  const postSlides = normalizeSlidesForCompare(post.socialPack?.instagramSlides)
  return (
    String(draft.title || '').trim() === String(post.title || '').trim() &&
    String(draft.slug || post.slug || '').trim() === String(post.slug || '').trim() &&
    String(draft.imageUrl || '').trim() === String(post.imageUrl || '').trim() &&
    String(draft.instagramCaption || '').trim() === String(post.socialPack?.instagramCaption || '').trim() &&
    JSON.stringify(slides) === JSON.stringify(postSlides)
  )
}

function isMeaningfulLocalDraft({ slug, draft }, posts = cachedPosts) {
  if (slug === '__new__') return Boolean((draft.title || '').trim() || (draft.bodyHtml || '').trim())
  const post = posts.find((p) => p.slug === slug)
  if (!post) return true
  return !draftLooksSaved(draft, post)
}

function pruneMatchingLocalDrafts(site = currentSite()) {
  for (const item of listLocalDrafts(site)) {
    if (!isMeaningfulLocalDraft(item)) clearLocalDraft(site, item.slug)
  }
}

function armCleanAfterSave(state) {
  clearTimeout(localSaveTimer)
  skipLocalSave = true
  rememberSavedState(state || collectFormState())
  markLocalDirty(false)
  setTimeout(() => {
    rememberSavedState(collectFormState())
    skipLocalSave = false
    markLocalDirty(false)
    const slug = (form.slug.value || editingOriginalSlug || '').trim()
    if (slug) clearLocalDraft(currentSite(), slug)
    renderLocalInbox()
  }, 800)
}

function applyFormState(state) {
  skipLocalSave = true
  try {
    form.title.value = state.title || ''
    form.slug.value = state.slug || ''
    form.authorName.value = state.authorName || 'Silvia'
    postStatusInput.value = state.status || 'draft'
    form.datePublished.value = state.datePublished || ''
    form.dateModified.value = state.dateModified || ''
    form.metaTitleEs.value = state.metaTitleEs || ''
    form.metaDescriptionEs.value = state.metaDescriptionEs || ''
    form.excerptEs.value = state.excerptEs || ''
    form.imageUrl.value = state.imageUrl || ''
    form.imageAlt.value = state.imageAlt || ''
    form.relatedSlugs.value = state.relatedSlugs || ''
    form.substackTitle.value = state.substackTitle || ''
    form.substackBody.value = state.substackBody || ''
    form.linkedin.value = state.linkedin || ''
    form.x.value = state.x || ''
    if (form.videoScript) form.videoScript.value = state.videoScript || ''
    if (form.instagramCaption) form.instagramCaption.value = state.instagramCaption || ''
    const visibleCaption = document.getElementById('fieldInstagramCaptionVisible')
    if (visibleCaption && visibleCaption !== form.instagramCaption) {
      visibleCaption.value = state.instagramCaption || ''
    }
    if (form.instagramSlides) form.instagramSlides.value = state.instagramSlides || ''
    form.bodyHtml.value = state.bodyHtml || ''
    setBodyValue(state.bodyHtml || '')
    updateImagePreview()
    renderCarouselStrip()
    updateWorkspaceChrome()
  } finally {
    skipLocalSave = false
  }
}

function updateDockStatus() {
  const el = document.getElementById('editorDockStatus')
  if (!el) return
  el.textContent = localDirty
    ? 'Hay cambios en este navegador. Guardar los envía al CMS. Publicar actualiza la web.'
    : 'Todo está en el CMS. Publicar actualiza la web.'
}

function updateDockNav() {
  const prev = document.getElementById('dockPrev')
  const next = document.getElementById('dockNext')
  if (currentStep === 'escribir') {
    if (prev) prev.hidden = true
    if (next) {
      next.hidden = false
      next.textContent = 'Fotos y redes'
    }
    if (publishPostBtn) publishPostBtn.hidden = true
  } else if (currentStep === 'portada') {
    if (prev) {
      prev.hidden = false
      prev.textContent = 'Texto'
    }
    if (next) {
      next.hidden = false
      next.textContent = 'Revisar'
    }
    if (publishPostBtn) publishPostBtn.hidden = true
  } else {
    if (prev) {
      prev.hidden = false
      prev.textContent = 'Fotos y redes'
    }
    if (next) next.hidden = true
    if (publishPostBtn) publishPostBtn.hidden = false
  }
  updateDockStatus()
  syncEditorLifecycleButtons(postStatusInput.value || 'draft')
}

function markLocalDirty(dirty) {
  localDirty = Boolean(dirty)
  updateDockStatus()
}

function saveLocalDraftNow() {
  if (currentRoute?.view !== 'entrada') return
  const site = currentSite()
  const state = collectFormState()
  const slug = (state.slug || editingOriginalSlug || '__new__').trim() || '__new__'
  if (isSameAsSaved(state)) {
    clearLocalDraft(site, slug)
    markLocalDirty(false)
    return
  }
  const payload = { ...state, savedAt: Date.now() }
  localStorage.setItem(localDraftStorageKey(site, slug), JSON.stringify(payload))
  if (slug !== '__new__') localStorage.removeItem(localDraftStorageKey(site, '__new__'))
  markLocalDirty(true)
}

function scheduleLocalSave() {
  if (skipLocalSave || currentRoute?.view !== 'entrada') return
  if (isSameAsSaved()) {
    markLocalDirty(false)
    return
  }
  markLocalDirty(true)
  clearTimeout(localSaveTimer)
  localSaveTimer = setTimeout(saveLocalDraftNow, 400)
}

function updateReviewCallout(status) {
  const el = document.getElementById('reviewStatusCallout')
  if (!el) return
  if (status === 'review') {
    el.hidden = false
    el.className = 'status-callout status-callout--review'
    el.textContent = 'Esta entrada espera tu OK. Publicar en vivo la manda al blog.'
  } else {
    el.hidden = true
    el.textContent = ''
    el.className = 'status-callout'
  }
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
  scheduleLocalSave()
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
      loadMedia().catch(() => {})
    }
    item.append(img, indexBadge, remove)
    el.appendChild(item)
  })
}

function rebuildSaveMessage(data, fallback = 'Entrada guardada en el CMS') {
  if (data?.hint) return { text: data.hint, sticky: Boolean(data.demotedToReview) }
  if (data?.savedOnly) {
    return { text: 'Guardado en el CMS. La web pública cambia cuando publiques en vivo.', sticky: false }
  }
  const published = (data?.post?.status || postStatusInput.value) === 'published'
  if (!published) return { text: fallback, sticky: false }
  if (data?.rebuild?.ok) {
    return { text: 'Publicado. Rebuild de la web disparado. La portada pública cambia cuando termine Coolify.', sticky: false }
  }
  const detail = data?.rebuild?.message || 'Revisa el webhook de Coolify en Sitio.'
  return {
    text: `Guardado en el CMS. La web pública sigue igual. ${detail}`,
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

function uploadMediaForm({ file, filename, alt, kind, site }) {
  const form = new FormData()
  form.append('file', file, filename || file.name)
  form.append('site', site)
  form.append('filename', filename || file.name)
  form.append('alt', alt || '')
  form.append('kind', kind || 'post')
  return api('/api/admin/media/upload', { method: 'POST', body: form })
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
  scheduleLocalSave()
  loadMedia().catch(() => {})
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
    loadMedia().catch(() => {})
    return
  }
  slides.push({
    imageUrl: src,
    alt: item.alt || '',
    headline: item.alt || '',
    body: ''
  })
  writeCarouselSlides(slides)
  loadMedia().catch(() => {})
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
  try {
    bodyEditor.on('change', () => scheduleLocalSave())
  } catch {
    /* editor sin eventos */
  }
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
  if (!imagePreview) return
  if (!src) {
    imagePreview.hidden = false
    imagePreview.innerHTML = '<p class="empty">Elige la portada en la parrilla. El recuadro la marca.</p>'
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
  return { Authorization: 'Bearer ' + token }
}

async function api(path, options = {}) {
  const headers = { ...authHeaders(), ...(options.headers || {}) }
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (!isForm && options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, { ...options, headers })
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
      topbarHint.textContent = 'El navegador guarda solo. Un Guardar envía todo al CMS. Publicar actualiza la web.'
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

  const dock = document.getElementById('editorDock')
  if (dock) dock.hidden = view !== 'entrada'
  document.body.classList.toggle('has-editor-dock', view === 'entrada')
  if (view === 'entrada') updateDockNav()
  if (view === 'entradas') {
    renderReviewInbox(cachedPosts)
    renderLocalInbox()
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
  updateDockNav()

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
    updateReviewCallout(postStatusInput.value)
    if (localDirty) {
      previewStatus.textContent = 'La vista previa lee el CMS. Guardar primero para ver estos cambios.'
    }
    if (slug) showPreviewForSlug(slug)
    else {
      previewStatus.textContent = 'Pon título y slug. Luego Guardar. Así sale la vista previa.'
      previewFrame.src = 'about:blank'
      previewUrl.textContent = ''
    }
  }
}

function goToStep(step, { replace = false } = {}) {
  navigate({
    view: 'entrada',
    slug: editingOriginalSlug || null,
    isNew: !editingOriginalSlug,
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
  skipLocalSave = true
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
  const visibleCaption = document.getElementById('fieldInstagramCaptionVisible')
  if (visibleCaption && visibleCaption !== form.instagramCaption) {
    visibleCaption.value = p.socialPack?.instagramCaption || ''
  }
  if (form.instagramSlides) form.instagramSlides.value = formatInstagramSlides(p.socialPack?.instagramSlides)
  form.bodyHtml.value = p.bodyHtml || ''
  setBodyValue(p.bodyHtml || '')
  updateImagePreview()
  renderCarouselStrip()
  showPublishBanner('')
  applySocialPackChannelUi(socialPackChannels)
  updateWorkspaceChrome()
  skipLocalSave = false

  const local = readLocalDraft(currentSite(), p.slug)
  if (local && !draftLooksSaved(local, p)) {
    applyFormState({ ...local, status: local.status || p.status || 'draft' })
    markLocalDirty(true)
    toast('Hay cambios de este navegador. Guardar los envía al CMS.')
  } else {
    if (local) clearLocalDraft(currentSite(), p.slug)
    armCleanAfterSave()
  }
  updateReviewCallout(postStatusInput.value)
}

function resetFormFields() {
  skipLocalSave = true
  editingOriginalSlug = ''
  form.reset()
  form.authorName.value = 'Silvia'
  postStatusInput.value = 'draft'
  const visibleCaption = document.getElementById('fieldInstagramCaptionVisible')
  if (visibleCaption) visibleCaption.value = ''
  setBodyValue('')
  updateImagePreview()
  renderCarouselStrip()
  showPublishBanner('')
  if (seoResult) {
    seoResult.hidden = true
    seoResult.innerHTML = ''
  }
  updateWorkspaceChrome()
  skipLocalSave = false

  const local = readLocalDraft(currentSite(), '__new__')
  if (local) {
    applyFormState(local)
    markLocalDirty(true)
    toast('Recuperé el borrador de este navegador.')
  } else {
    armCleanAfterSave()
  }
  updateReviewCallout('draft')
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
    toast('Pon un slug y pulsa Guardar para previsualizar')
    return
  }
  if (localDirty) {
    toast('La vista previa lee el CMS. Guardar primero para ver estos cambios.')
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
  btn.onclick = () => {
    if (currentRoute?.view === 'entrada') saveLocalDraftNow()
    navigate({ view: btn.dataset.route })
  }
})

document.querySelectorAll('.step-btn').forEach((btn) => {
  btn.onclick = () => goToStep(btn.dataset.step)
})

document.getElementById('backToList')?.addEventListener('click', () => {
  saveLocalDraftNow()
  navigate({ view: 'entradas' })
})

document.getElementById('dockPrev')?.addEventListener('click', () => {
  if (currentStep === 'portada') goToStep('escribir')
  else if (currentStep === 'revisar') goToStep('portada')
})

document.getElementById('dockNext')?.addEventListener('click', () => {
  if (currentStep === 'escribir') goToStep('portada')
  else if (currentStep === 'portada') goToStep('revisar')
})

document.getElementById('goToPortada')?.addEventListener('click', () => goToStep('portada'))
document.getElementById('goToEscribir')?.addEventListener('click', () => goToStep('escribir'))
document.getElementById('goToRevisar')?.addEventListener('click', () => goToStep('revisar'))
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

function renderReviewInbox(posts) {
  const el = document.getElementById('reviewInbox')
  if (!el) return
  const review = (posts || []).filter((p) => p.status === 'review')
  if (!review.length) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  el.hidden = false
  el.innerHTML = ''
  const intro = document.createElement('p')
  intro.textContent = review.length === 1
    ? 'Hay 1 entrada esperando tu OK. Publicar en vivo la manda al blog.'
    : `Hay ${review.length} entradas esperando tu OK. Publicar en vivo las manda al blog.`
  const ul = document.createElement('ul')
  review.forEach((p) => {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'inbox-link'
    btn.textContent = p.title || p.slug
    btn.onclick = () => openPostWorkspace(p, 'revisar')
    li.appendChild(btn)
    ul.appendChild(li)
  })
  el.append(intro, ul)
}

function renderLocalInbox() {
  const el = document.getElementById('localInbox')
  const btn = document.getElementById('flushLocalDrafts')
  const drafts = listLocalDrafts().filter((item) => isMeaningfulLocalDraft(item))
  if (!el) return
  if (!drafts.length) {
    el.hidden = true
    el.innerHTML = ''
    if (btn) btn.hidden = true
    return
  }
  el.hidden = false
  if (btn) btn.hidden = false
  el.innerHTML = ''
  const intro = document.createElement('p')
  intro.textContent = drafts.length === 1
    ? 'Hay cambios de 1 entrada en este navegador. Enviar los guarda en el CMS sin tocar la web.'
    : `Hay cambios de ${drafts.length} entradas en este navegador. Enviar los guarda en el CMS sin tocar la web.`
  const ul = document.createElement('ul')
  drafts.forEach(({ slug, draft }) => {
    const li = document.createElement('li')
    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'inbox-link'
    label.textContent = draft.title || slug
    label.onclick = () => {
      if (slug === '__new__') openPostWorkspace(null, 'escribir')
      else {
        const post = cachedPosts.find((p) => p.slug === slug)
        if (post) openPostWorkspace(post, 'escribir')
        else {
          applyFormState(draft)
          editingOriginalSlug = slug === '__new__' ? '' : slug
          navigate({ view: 'entrada', slug: slug === '__new__' ? null : slug, isNew: slug === '__new__', step: 'escribir' })
        }
      }
    }
    li.appendChild(label)
    ul.appendChild(li)
  })
  el.append(intro, ul)
}

async function loadPosts() {
  const site = currentSite()
  const status = statusFilter.value
  list.innerHTML = '<li class="empty">Cargando entradas…</li>'
  const data = await api('/api/admin/posts?' + new URLSearchParams({ site }))
  list.innerHTML = ''
  cachedPosts = data.posts || []
  pruneMatchingLocalDrafts(site)
  renderReviewInbox(cachedPosts)
  renderLocalInbox()
  const posts = status ? cachedPosts.filter((p) => p.status === status) : cachedPosts
  const localSlugs = new Set(
    listLocalDrafts(site).filter((item) => isMeaningfulLocalDraft(item)).map((item) => item.slug)
  )
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
    const localHint = localSlugs.has(p.slug)
      ? '<span class="post-local-badge">En este navegador</span>'
      : ''
    const main = document.createElement('div')
    main.className = 'post-item-main'
    main.innerHTML = `<div><strong>${escapeHtml(p.title)}</strong><span class="badge ${p.status}">${statusLabel(p.status)}</span>${localHint}<div class="post-meta">${escapeHtml(p.slug)}</div>${statusHint}</div>`
    main.style.cursor = 'pointer'
    main.onclick = () => openPostWorkspace(p, 'escribir')

    const actions = document.createElement('div')
    actions.className = 'actions post-actions'
    actions.appendChild(createIconBtn({
      className: 'icon-btn icon-btn--accent',
      title: 'Abrir',
      icon: ICONS.editor,
      onClick: () => openPostWorkspace(p, 'escribir')
    }))
    actions.appendChild(createIconBtn({
      className: 'icon-btn icon-btn--accent',
      title: 'Revisar',
      icon: ICONS.preview,
      onClick: () => openPostWorkspace(p, 'revisar')
    }))
    if (p.status === 'review' || p.status === 'draft') {
      actions.appendChild(createIconBtn({
        className: 'icon-btn icon-btn--accent',
        title: p.status === 'review' ? 'Publicar en vivo' : 'Enviar a revisión',
        icon: ICONS.check,
        onClick: () => publishSlug(p.slug)
      }))
    }

    const moreWrap = document.createElement('div')
    moreWrap.className = 'more-menu'
    const moreBtn = document.createElement('button')
    moreBtn.type = 'button'
    moreBtn.className = 'icon-btn icon-btn--accent'
    moreBtn.setAttribute('aria-label', 'Más acciones')
    moreBtn.title = 'Más acciones'
    moreBtn.innerHTML = ICONS.more
    const menu = document.createElement('div')
    menu.className = 'more-menu-panel'
    menu.hidden = true

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
  if (unpublishBtn) unpublishBtn.hidden = !(editingOriginalSlug && status === 'published')
  if (deleteBtn) deleteBtn.hidden = !editingOriginalSlug
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

async function persistPost({ busyBtn, state, silent = false } = {}) {
  const site = currentSite()
  const formState = state || collectFormState()
  const isCurrentEditor = !state
  const slug = (formState.slug || '').trim()
  const title = (formState.title || '').trim()
  if (!slug || !title) {
    toast('Faltan título y slug. Complétalos en Texto y pulsa Guardar.')
    return false
  }

  const run = async () => {
    const lookupSlug = String(formState.originalSlug || (isCurrentEditor ? editingOriginalSlug : '') || '').trim()
    const needsCreate = !lookupSlug || lookupSlug === '__new__'
    if (needsCreate) {
      try {
        await api('/api/admin/posts/create-draft', {
          method: 'POST',
          body: JSON.stringify({
            site,
            title,
            slug,
            author: (formState.authorName || '').trim() || 'Silvia',
            date: formState.datePublished || undefined
          })
        })
      } catch (err) {
        if (!/Ya existe slug/i.test(err.message || '')) {
          toast(err.message)
          return false
        }
      }
    }

    const slides = parseInstagramSlides(formState.instagramSlides)
    if (slides === null) {
      toast('El JSON de slides de Instagram no es válido')
      return false
    }

    const payload = {
      site,
      slug,
      originalSlug: needsCreate ? slug : lookupSlug,
      keepPublished: formState.status === 'published',
      title,
      authorName: (formState.authorName || '').trim(),
      status: formState.status,
      datePublished: formState.datePublished,
      dateModified: formState.dateModified,
      metaTitle: { es: (formState.metaTitleEs || '').trim(), en: (formState.metaTitleEs || '').trim() },
      metaDescription: { es: (formState.metaDescriptionEs || '').trim(), en: (formState.metaDescriptionEs || '').trim() },
      excerptEs: (formState.excerptEs || '').trim(),
      imageUrl: (formState.imageUrl || '').trim(),
      imageAlt: (formState.imageAlt || '').trim(),
      relatedSlugs: String(formState.relatedSlugs || '').split(',').map((s) => s.trim()).filter(Boolean),
      socialPack: {
        substackTitle: (formState.substackTitle || '').trim(),
        substackBody: (formState.substackBody || '').trim(),
        linkedin: (formState.linkedin || '').trim(),
        x: (formState.x || '').trim(),
        videoScript: (formState.videoScript || '').trim(),
        instagramCaption: (formState.instagramCaption || '').trim(),
        instagramSlides: slides
      },
      bodyHtml: formState.bodyHtml
    }
    const data = await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(payload) })
    clearLocalDraft(site, slug)
    if (lookupSlug && lookupSlug !== slug) clearLocalDraft(site, lookupSlug)
    if (needsCreate) clearLocalDraft(site, '__new__')
    if (isCurrentEditor) {
      editingOriginalSlug = slug
      armCleanAfterSave(formState)
      updateWorkspaceChrome()
      renderCarouselStrip()
      navigate({
        view: 'entrada',
        slug,
        isNew: false,
        step: currentStep
      }, { replace: true })
      if (currentStep === 'revisar') {
        showPublishBanner((data.hint || 'Guardado en el CMS.'), data.demotedToReview ? 'review' : 'ok')
        showPreviewForSlug(slug)
      }
    }
    if (!silent) {
      await loadPosts()
      const msg = rebuildSaveMessage(data)
      toast(msg.text, { sticky: msg.sticky, duration: msg.sticky ? 0 : 12000 })
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

async function flushAllLocalDrafts() {
  const btn = document.getElementById('flushLocalDrafts')
  const drafts = listLocalDrafts().filter((item) => isMeaningfulLocalDraft(item))
  if (!drafts.length) {
    toast('Este navegador no tiene cambios pendientes.')
    return
  }
  const run = async () => {
    let ok = 0
    let failed = 0
    if (currentRoute?.view === 'entrada' && localDirty) {
      const saved = await persistPost({ silent: true })
      if (saved) ok += 1
      else failed += 1
    }
    for (const item of listLocalDrafts()) {
      const draftSlug = item.slug === '__new__' ? (item.draft.slug || '').trim() : item.slug
      if (!draftSlug || !(item.draft.title || '').trim()) {
        failed += 1
        continue
      }
      const saved = await persistPost({
        state: { ...item.draft, slug: draftSlug, originalSlug: item.slug === '__new__' ? '' : item.slug },
        silent: true
      })
      if (saved) {
        ok += 1
        clearLocalDraft(currentSite(), item.slug)
      } else failed += 1
    }
    await loadPosts()
    if (failed) toast(`Guardé ${ok} en el CMS. ${failed} se quedaron en este navegador.`)
    else toast(ok === 1 ? 'Cambios enviados al CMS.' : `${ok} entradas enviadas al CMS.`)
  }
  if (btn) await withBusy(btn, 'Enviando…', run)
  else await run()
}

form.onsubmit = async (e) => {
  e.preventDefault()
  await persistPost({ busyBtn: document.getElementById('dockSave') })
}

document.getElementById('flushLocalDrafts')?.addEventListener('click', () => {
  flushAllLocalDrafts().catch((err) => toast(err.message))
})

form.addEventListener('input', () => scheduleLocalSave())
form.addEventListener('change', () => scheduleLocalSave())
document.getElementById('fieldInstagramCaptionVisible')?.addEventListener('input', () => {
  if (form.instagramCaption && form.instagramCaption !== document.getElementById('fieldInstagramCaptionVisible')) {
    form.instagramCaption.value = document.getElementById('fieldInstagramCaptionVisible').value
  }
  scheduleLocalSave()
})

document.getElementById('validateSeo').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  if (!slug) return toast('Pon un slug. Luego Guardar. Así puedes validar SEO')
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
  if (!slug) return toast('Pon título y slug. Luego Guardar. Después publica.')
  try {
    if (localDirty) {
      const saved = await persistPost({ busyBtn: publishPostBtn })
      if (!saved) return
    }
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
    const data = await uploadMediaForm({
      file,
      filename: file.name,
      alt: document.getElementById('uploadAlt').value,
      kind,
      site
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
    await uploadMediaForm({
      file,
      filename: file.name,
      alt: document.getElementById('libraryAlt')?.value || '',
      kind: document.getElementById('libraryKind')?.value || 'post',
      site
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
    await uploadMediaForm({
      file,
      filename: file.name,
      alt: document.getElementById('refAlt').value,
      kind: 'reference',
      site
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
