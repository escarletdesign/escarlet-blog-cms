const ICONS = {
  editor: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  preview: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  more: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  image: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
}

const STATUS_LABELS = {
  draft: 'Borrador',
  review: 'En revisión',
  published: 'Publicado'
}

const STEP_HINTS = {
  escribir: 'Paso 1 de 3. Escribe el contenido y guarda antes de seguir.',
  portada: 'Paso 2 de 3. Elige o sube la imagen de portada.',
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
  toast('Portada aplicada a la entrada')
}

function renderMediaGrid(target, items, { allowUse = false } = {}) {
  target.innerHTML = ''
  if (!items.length) {
    target.innerHTML = '<p class="empty">Todavía no hay imágenes aquí.</p>'
    return
  }
  for (const item of items) {
    const div = document.createElement('div')
    div.className = 'media-card'
    const src = mediaSrc(item)
    const img = document.createElement('img')
    img.alt = item.alt || ''
    img.loading = 'lazy'
    img.src = src
    img.onerror = () => {
      const fallback = mediaSrc({ url: item.url, path: item.path })
      if (fallback && fallback !== img.src) img.src = fallback
    }
    const foot = document.createElement('div')
    foot.className = 'media-card-foot'
    const caption = document.createElement('p')
    const status = item.ok === false ? ' · archivo incompleto' : ''
    caption.textContent = (item.alt || item.filename || src) + status
    if (item.ok === false) caption.style.color = '#b42318'
    const actions = document.createElement('div')
    actions.className = 'media-card-actions'
    if (allowUse) {
      const useBtn = document.createElement('button')
      useBtn.type = 'button'
      useBtn.className = 'btn btn-sm btn-primary'
      useBtn.textContent = 'Usar'
      useBtn.title = 'Usar como portada de esta entrada'
      useBtn.onclick = () => applyImageToPost(item)
      actions.appendChild(useBtn)
    }
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'btn btn-sm media-delete'
    del.title = 'Eliminar imagen'
    del.setAttribute('aria-label', 'Eliminar imagen')
    del.innerHTML = ICONS.trash
    del.onclick = async () => {
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
        else await loadRefs()
      } catch (err) {
        toast(err.message)
      }
    }
    actions.appendChild(del)
    foot.append(caption, actions)
    div.append(img, foot)
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

function bodyValue() {
  if (bodyEditor) return bodyEditor.getMarkdown()
  return bodyContent?.value || ''
}

function setBodyValue(text) {
  ensureBodyEditor()
  if (bodyEditor) bodyEditor.setMarkdown(text || '')
  else if (bodyContent) bodyContent.value = text || ''
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
  imagePreview.innerHTML = `<img src="${src}" alt="Vista previa de portada" onerror="this.closest('.image-preview').hidden=true" />`
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
      topbarHint.textContent =
        view === 'marca'
          ? 'Textos y referencias que usa el agente al crear contenido.'
          : view === 'sitio'
            ? 'Crea un sitio nuevo o ajusta dominio y webhook del activo.'
            : 'Empieza por Entradas. Abre un borrador y avanza paso a paso hasta publicar.'
    }
  }

  if (view === 'marca') {
    loadBrand().catch((e) => toast(e.message))
    loadRefs().catch((e) => toast(e.message))
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
  form.bodyHtml.value = p.bodyHtml || ''
  setBodyValue(p.bodyHtml || '')
  updateImagePreview()
  showPublishBanner('')
  updateWorkspaceChrome()
}

function resetFormFields() {
  editingOriginalSlug = ''
  form.reset()
  form.authorName.value = 'Silvia'
  postStatusInput.value = 'draft'
  setBodyValue('')
  updateImagePreview()
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

async function afterLogin() {
  try {
    authSession = await api('/api/admin/session')
  } catch {
    authSession = { role: 'admin', canCreateSites: true, sites: [] }
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
  const isAdmin = authSession?.role === 'admin'
  const startBtn = document.getElementById('startNewSite')
  const accessCard = document.getElementById('siteAccessCard')
  const adminActions = document.getElementById('siteAdminActions')
  const webhookLabel = document.querySelector('label[for="siteWebhook"]')
  if (startBtn) startBtn.hidden = !isAdmin
  if (accessCard) accessCard.hidden = !isAdmin
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
    const wrap = el.closest('.help-callout') || el.parentElement
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
  if (topbarHint && !isAdmin) {
    topbarHint.textContent = `Token de sitio. Solo gestionas ${authSession.site || 'este proyecto'}.`
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

    authSession = {
      role: data.role || 'admin',
      site: data.site || null,
      sites: data.sites || [],
      canCreateSites: Boolean(data.canCreateSites),
      canManageAllSites: Boolean(data.canManageAllSites)
    }
    if (data.role === 'site' && data.site) {
      localStorage.setItem('escarlet_cms_site', data.site)
      if (siteFilter) siteFilter.dataset.pending = data.site
    }
    localStorage.setItem('escarlet_cms_token', token)
    await afterLogin()
    toast(data.role === 'site' ? `Sesión del sitio ${data.site}` : 'Sesión de administrador')
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
document.getElementById('goToRevisar')?.addEventListener('click', () => goToStep('revisar'))
document.getElementById('goBackPortada')?.addEventListener('click', () => goToStep('portada'))

menuToggle?.addEventListener('click', () => {
  if (sidebar?.classList.contains('open')) closeSidebar()
  else openSidebar()
})
sidebarBackdrop?.addEventListener('click', closeSidebar)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebar?.classList.contains('open')) {
    closeSidebar()
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
    edit.className = 'btn btn-sm btn-primary'
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

form.onsubmit = async (e) => {
  e.preventDefault()
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  const title = form.title.value.trim()
  if (!slug || !title) return toast('Faltan título y slug')

  const saveBtn = document.getElementById('savePost')
  await withBusy(saveBtn, 'Guardando…', async () => {
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
          return
        }
        editingOriginalSlug = slug
      }
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
        x: form.x.value.trim()
      },
      bodyHtml: bodyValue()
    }
    try {
      await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(payload) })
      editingOriginalSlug = slug
      await loadPosts()
      updateWorkspaceChrome()
      navigate({
        view: 'entrada',
        slug,
        isNew: false,
        step: currentStep
      }, { replace: true })
      toast('Entrada guardada')
    } catch (err) {
      toast(err.message)
    }
  })
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
  const data = await api('/api/admin/media?site=' + site)
  renderMediaGrid(mediaGrid, data.media || [], { allowUse: true })
}

document.getElementById('uploadForm').onsubmit = async (e) => {
  e.preventDefault()
  const file = document.getElementById('uploadFile').files[0]
  if (!file) return toast('Elige un archivo de imagen')
  const btn = document.getElementById('uploadBtn')
  await withBusy(btn, 'Subiendo…', async () => {
    const site = siteFilter.value.trim() || 'escarlet'
    const data = await api('/api/admin/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        site,
        filename: file.name,
        contentBase64: await fileToBase64(file),
        alt: document.getElementById('uploadAlt').value,
        kind: document.getElementById('uploadKind').value
      })
    })
    if (data.media && document.getElementById('uploadKind').value === 'post') {
      applyImageToPost(data.media)
    }
    document.getElementById('uploadFile').value = ''
    await loadMedia()
    toast('Imagen subida')
  })
}

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
  const accessResult = document.getElementById('siteAccessResult')
  if (accessResult) {
    accessResult.hidden = true
    accessResult.textContent = ''
  }
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
      requiresHumanApproval: siteHumanApproval.checked
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
    const out = document.getElementById('siteAccessResult')
    if (out) {
      out.hidden = false
      out.textContent = `${data.message || 'Token generado'}\n\n${data.siteAccessToken || ''}`
    }
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
    const out = document.getElementById('siteAccessResult')
    if (out) {
      out.hidden = true
      out.textContent = ''
    }
    const accessStatus = document.getElementById('siteAccessStatus')
    if (accessStatus) accessStatus.textContent = 'Sin token de cliente todavía.'
    toast('Token de cliente revocado')
  })
})

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
