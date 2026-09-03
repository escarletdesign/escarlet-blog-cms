const ICONS = {
  posts: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  editor: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  preview: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  media: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
  brand: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
  site: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  refresh: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  save: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.8Z"/><path d="M14 3v4a2 2 0 0 0 2 2h4"/><path d="M10 12v6"/><path d="M14 12v6"/><path d="M8 12v6"/></svg>',
  upload: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
  logout: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  send: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>'
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
const siteWebhook = document.getElementById('siteWebhook')
const siteCoolifyToken = document.getElementById('siteCoolifyToken')
const siteTokenStatus = document.getElementById('siteTokenStatus')
const rebuildResult = document.getElementById('rebuildResult')
const siteHumanApproval = document.getElementById('siteHumanApproval')
const toastEl = document.getElementById('toast')
const toastMessage = document.getElementById('toastMessage')
const toastClose = document.getElementById('toastClose')
const siteLabel = document.getElementById('siteLabel')
const publishBanner = document.getElementById('publishBanner')
const publishPostBtn = document.getElementById('publishPost')
const previewPublishBtn = document.getElementById('previewPublish')
const loginError = document.getElementById('loginError')
const enterBtn = document.getElementById('enter')
const previewPostSelect = document.getElementById('previewPostSelect')
const previewStatus = document.getElementById('previewStatus')
const imagePreview = document.getElementById('imagePreview')
const imageUrlInput = document.getElementById('imageUrlInput')
const bodyContent = document.getElementById('bodyContent')
const menuToggle = document.getElementById('menuToggle')
const sidebar = document.getElementById('sidebar')
const sidebarBackdrop = document.getElementById('sidebarBackdrop')
let brandEditor = null
let bodyEditor = null
let cachedPosts = []
let humanApprovalRequired = true
let editingOriginalSlug = ''
let token = localStorage.getItem('escarlet_cms_token') || ''

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

function setPublishLabels(status) {
  const label =
    status === 'review'
      ? 'Publicar en vivo'
      : humanApprovalRequired
        ? 'Enviar a revisión'
        : 'Publicar en vivo'
  if (publishPostBtn) publishPostBtn.textContent = label
  if (previewPublishBtn) previewPublishBtn.textContent = label
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

function renderMediaGrid(target, items) {
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
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'btn btn-sm media-delete'
    del.title = 'Eliminar imagen'
    del.setAttribute('aria-label', 'Eliminar imagen')
    del.innerHTML = ICONS.trash
    del.onclick = async () => {
      if (!item.id && !item.path && !item.url) {
        toast('No se puede identificar esta imagen.')
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
    foot.append(caption, del)
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

function ensureBrandEditor() {
  if (brandEditor) {
    requestAnimationFrame(() => brandEditor.focus?.())
    return brandEditor
  }
  brandEditor = createToastEditor('brandEditorMount', '420px')
  return brandEditor
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
  if (brandEditor) return brandEditor.getMarkdown()
  return brandContent?.value || ''
}

function setBrandValue(text) {
  ensureBrandEditor()
  if (brandEditor) {
    brandEditor.setMarkdown(text || '')
    // Toast UI a veces nace con altura 0 si el panel estaba oculto
    setTimeout(() => {
      try {
        brandEditor.setHeight('420px')
      } catch {}
    }, 30)
  } else if (brandContent) brandContent.value = text || ''
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
}

function openSidebar() {
  sidebar?.classList.add('open')
  sidebarBackdrop?.removeAttribute('hidden')
  document.body.classList.add('nav-open')
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

function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'))
  document.getElementById('panel-' + tab)?.classList.add('active')
  if (tab === 'brand') {
    ensureBrandEditor()
    setTimeout(() => {
      try {
        brandEditor?.setHeight('420px')
      } catch {}
    }, 50)
  }
  if (tab === 'editor') {
    ensureBodyEditor()
    setTimeout(() => {
      try {
        bodyEditor?.setHeight('420px')
      } catch {}
    }, 50)
  }
  if (tab === 'preview') {
    populatePreviewSelect()
    const slug = previewPostSelect?.value
    if (slug) showPreviewForSlug(slug)
  }
  closeSidebar()
}

function populatePreviewSelect(posts = cachedPosts) {
  if (!previewPostSelect) return
  previewPostSelect.innerHTML = ''
  if (!posts.length) {
    previewPostSelect.innerHTML = '<option value="">No hay posts con este filtro</option>'
    return
  }
  for (const p of posts) {
    const opt = document.createElement('option')
    opt.value = p.slug
    opt.textContent = `${p.title} (${p.status})`
    previewPostSelect.appendChild(opt)
  }
}

function buildPreviewUrl(slug) {
  const site = siteFilter.value.trim() || 'escarlet'
  return `/preview/${site}/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`
}

function updatePreviewStatus(slug) {
  if (!previewStatus) return
  const post = cachedPosts.find((p) => p.slug === slug)
  if (!post) {
    previewStatus.innerHTML = ''
    setPublishLabels('draft')
    return
  }
  const hint =
    post.status === 'review'
      ? 'Listo para tu OK. Pulsa Publicar en vivo para mandarlo al blog.'
      : post.status === 'draft'
        ? 'Borrador. El primer paso lo envía a revisión humana.'
        : 'Ya está publicado en el blog.'
  previewStatus.innerHTML = `Estado actual. <span class="badge ${post.status}">${post.status}</span> ${hint}`
  setPublishLabels(post.status)
}

function showPreviewForSlug(slug, { newTab = false } = {}) {
  if (!slug) {
    toast('Elige un post para previsualizar')
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
  await loadPosts()
  await loadMedia()
  await loadBrand()
  await loadRefs()
  await loadSite()
  ensureBrandEditor()
  ensureBodyEditor()
  updateImagePreview()
  login.hidden = true
  app.hidden = false
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
    await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Token incorrecto')
      return data
    })

    localStorage.setItem('escarlet_cms_token', token)
    await afterLogin()
    toast('Sesión iniciada')
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
}

if (token) {
  tokenInput.value = token
  doLogin().catch(() => {
    login.hidden = false
    app.hidden = true
  })
}

document.querySelectorAll('.nav-btn[data-tab]').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab)
})

menuToggle?.addEventListener('click', () => {
  if (sidebar?.classList.contains('open')) closeSidebar()
  else openSidebar()
})
sidebarBackdrop?.addEventListener('click', closeSidebar)

async function loadPosts() {
  const site = siteFilter.value.trim() || 'escarlet'
  const status = statusFilter.value
  const q = new URLSearchParams({ site })
  if (status) q.set('status', status)
  const data = await api('/api/admin/posts?' + q)
  list.innerHTML = ''
  const posts = data.posts || []
  cachedPosts = posts
  populatePreviewSelect(posts)
  if (!posts.length) {
    list.innerHTML = '<li class="empty">No hay posts con este filtro.</li>'
    return
  }
  for (const p of posts) {
    const li = document.createElement('li')
    li.className = 'post-item'
    const statusHint =
      p.status === 'review'
        ? '<div class="post-meta">Pendiente de publicar en vivo</div>'
        : ''
    li.innerHTML = `<div><strong>${p.title}</strong><span class="badge ${p.status}">${p.status}</span><div class="post-meta">${p.slug}</div>${statusHint}</div>`
    const actions = document.createElement('div')
    actions.className = 'actions'
    const edit = document.createElement('button')
    edit.className = 'btn btn-sm'
    edit.innerHTML = ICONS.editor + ' Editar'
    edit.onclick = () => fillForm(p)
    const prev = document.createElement('button')
    prev.className = 'btn btn-sm'
    prev.innerHTML = ICONS.preview + ' Preview'
    prev.onclick = () => openPreview(p)
    const prevTab = document.createElement('button')
    prevTab.className = 'btn btn-sm'
    prevTab.innerHTML = ICONS.send + ' Nueva pestaña'
    prevTab.onclick = () => showPreviewForSlug(p.slug, { newTab: true })
    actions.append(edit, prev, prevTab)
    if (p.status === 'published') {
      const unpub = document.createElement('button')
      unpub.className = 'btn btn-sm'
      unpub.textContent = 'Despublicar'
      unpub.onclick = () => unpublishSlug(p.slug)
      actions.append(unpub)
    }
    if (p.status === 'review' || p.status === 'draft') {
      const pub = document.createElement('button')
      pub.className = 'btn btn-sm btn-primary'
      pub.textContent = p.status === 'review' ? 'Publicar en vivo' : 'Enviar a revisión'
      pub.onclick = () => publishSlug(p.slug)
      actions.append(pub)
    }
    const del = document.createElement('button')
    del.className = 'btn btn-sm btn-danger'
    del.innerHTML = ICONS.trash + ' Eliminar'
    del.onclick = () => deleteSlug(p.slug)
    actions.append(del)
    li.appendChild(actions)
    list.appendChild(li)
  }
}

function syncEditorLifecycleButtons(status) {
  const unpublishBtn = document.getElementById('unpublishPost')
  const deleteBtn = document.getElementById('deletePost')
  const hasPost = Boolean(editingOriginalSlug || form.slug.value.trim())
  if (unpublishBtn) {
    unpublishBtn.hidden = !(hasPost && status === 'published')
  }
  if (deleteBtn) {
    deleteBtn.hidden = !hasPost
  }
}

function fillForm(p) {
  editingOriginalSlug = p.slug || ''
  form.title.value = p.title || ''
  form.slug.value = p.slug || ''
  form.authorName.value = p.authorName || 'Silvia'
  form.status.value = p.status || 'draft'
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
  setPublishLabels(p.status || 'draft')
  syncEditorLifecycleButtons(p.status || 'draft')
  updateImagePreview()
  switchTab('editor')
}

function openPreview(p) {
  populatePreviewSelect(cachedPosts)
  if (previewPostSelect) previewPostSelect.value = p.slug
  showPreviewForSlug(p.slug)
  switchTab('preview')
}

form.status?.addEventListener('change', () => {
  setPublishLabels(form.status.value)
  syncEditorLifecycleButtons(form.status.value)
})

document.getElementById('unpublishPost')?.addEventListener('click', () => {
  const slug = editingOriginalSlug || form.slug.value.trim()
  unpublishSlug(slug)
})

document.getElementById('deletePost')?.addEventListener('click', () => {
  const slug = editingOriginalSlug || form.slug.value.trim()
  deleteSlug(slug)
})

document.getElementById('reloadPosts').onclick = loadPosts
statusFilter.onchange = loadPosts
siteFilter.onchange = () => { loadPosts(); loadMedia(); loadBrand(); loadRefs(); loadSite() }
form.imageUrl.addEventListener('input', updateImagePreview)
document.getElementById('loadPreview').onclick = () => showPreviewForSlug(previewPostSelect?.value)
document.getElementById('openPreviewTab').onclick = () => showPreviewForSlug(previewPostSelect?.value, { newTab: true })
previewPostSelect?.addEventListener('change', () => showPreviewForSlug(previewPostSelect.value))
document.getElementById('previewEdit').onclick = () => {
  const post = cachedPosts.find((p) => p.slug === previewPostSelect?.value)
  if (post) fillForm(post)
  else toast('Elige un post')
}
document.getElementById('previewPublish').onclick = async () => {
  const slug = previewPostSelect?.value
  if (!slug) return toast('Elige un post')
  await publishSlug(slug, { fromPreview: true })
}

async function publishSlug(slug, { fromPreview = false } = {}) {
  const site = siteFilter.value.trim() || 'escarlet'
  try {
    const data = await api('/api/admin/posts/publish', {
      method: 'POST',
      body: JSON.stringify({ site, slug })
    })
    const msg = data.submittedForReview
      ? (data.message ||
        'Enviado a revisión. En Posts aparece como review. Cuando esté listo, pulsa Publicar en vivo.')
      : data.rebuild
        ? (data.rebuild.ok
          ? 'Publicado en vivo. Rebuild del sitio disparado.'
          : `Publicado en vivo. El rebuild falló. ${data.rebuild.message || ''}`)
        : (data.message || 'Publicado en vivo')
    toast(msg, { sticky: Boolean(data.submittedForReview), duration: data.submittedForReview ? 0 : 12000 })
    if (fromPreview) {
      showPublishBanner(
        msg,
        data.submittedForReview ? 'review' : data.published ? 'ok' : 'info'
      )
    }
    if (seoResult && !fromPreview) seoResult.textContent = JSON.stringify(data, null, 2)
    await loadPosts()
    const updated = cachedPosts.find((p) => p.slug === slug)
    if (updated) {
      setPublishLabels(updated.status)
      if (form.slug.value === slug) form.status.value = updated.status
      if (editingOriginalSlug === slug || form.slug.value === slug) {
        syncEditorLifecycleButtons(updated.status)
      }
    }
    if (fromPreview || previewPostSelect?.value === slug) showPreviewForSlug(slug)
    return data
  } catch (err) {
    toast(err.message, { duration: 12000 })
    if (fromPreview) showPublishBanner(err.message, 'error')
    if (seoResult) seoResult.textContent = err.message
    throw err
  }
}

async function unpublishSlug(slug) {
  if (!slug) return toast('Falta slug')
  if (!confirm(`¿Despublicar «${slug}»? Pasará a draft y saldrá del blog.`)) return
  const site = siteFilter.value.trim() || 'escarlet'
  try {
    const data = await api('/api/admin/posts/unpublish', {
      method: 'POST',
      body: JSON.stringify({ site, slug })
    })
    toast(data.message || 'Post despublicado')
    await loadPosts()
    if (editingOriginalSlug === slug || form.slug.value === slug) {
      form.status.value = 'draft'
      setPublishLabels('draft')
      syncEditorLifecycleButtons('draft')
    }
  } catch (err) {
    toast(err.message)
  }
}

async function deleteSlug(slug) {
  if (!slug) return toast('Falta slug')
  if (!confirm(`¿Eliminar permanentemente «${slug}»? Esta acción no se puede deshacer.`)) return
  const site = siteFilter.value.trim() || 'escarlet'
  try {
    const data = await api(`/api/admin/posts/${encodeURIComponent(slug)}?site=${encodeURIComponent(site)}`, {
      method: 'DELETE'
    })
    toast(data.message || 'Post eliminado')
    if (editingOriginalSlug === slug || form.slug.value === slug) {
      editingOriginalSlug = ''
      form.reset()
      form.authorName.value = 'Silvia'
      form.status.value = 'draft'
      setBodyValue('')
      setPublishLabels('draft')
      syncEditorLifecycleButtons('draft')
    }
    await loadPosts()
  } catch (err) {
    toast(err.message)
  }
}

document.getElementById('newPost').onclick = () => {
  editingOriginalSlug = ''
  form.reset()
  form.authorName.value = 'Silvia'
  form.status.value = 'draft'
  setPublishLabels('draft')
  syncEditorLifecycleButtons('draft')
  showPublishBanner('')
  setBodyValue('')
  updateImagePreview()
  switchTab('editor')
}

form.onsubmit = async (e) => {
  e.preventDefault()
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  const title = form.title.value.trim()
  if (!slug || !title) return toast('Faltan título y slug')

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
    keepPublished: form.status.value === 'published',
    title,
    authorName: form.authorName.value.trim(),
    status: form.status.value,
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
    syncEditorLifecycleButtons(form.status.value)
    toast('Post guardado')
  } catch (err) {
    toast(err.message)
  }
}

document.getElementById('validateSeo').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  const data = await api('/api/admin/validate-seo', { method: 'POST', body: JSON.stringify({ site, slug }) })
  const lines = []
  lines.push(data.ok ? 'Listo para publicar.' : 'Hay bloqueos SEO.')
  lines.push(`Palabras: ${data.wordCount ?? '?'}`)
  if (data.errors?.length) {
    lines.push('Bloquean:')
    data.errors.forEach((e) => lines.push(`- ${e}`))
  }
  if (data.warnings?.length) {
    lines.push('Avisos (no bloquean):')
    data.warnings.forEach((w) => lines.push(`- ${w}`))
  }
  seoResult.textContent = lines.join('\n')
}

document.getElementById('publishPost').onclick = async () => {
  const slug = form.slug.value.trim()
  if (!slug) return toast('Guarda el post con un slug antes de publicar')
  try {
    await publishSlug(slug)
  } catch {
    /* toast ya mostrado */
  }
}

async function loadMedia() {
  const site = siteFilter.value.trim() || 'escarlet'
  const data = await api('/api/admin/media?site=' + site)
  renderMediaGrid(mediaGrid, data.media || [])
}

document.getElementById('uploadForm').onsubmit = async (e) => {
  e.preventDefault()
  const file = document.getElementById('uploadFile').files[0]
  if (!file) return
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
  if (data.media) {
    form.imageUrl.value = mediaSrc(data.media)
    updateImagePreview()
  }
  await loadMedia()
  toast('Imagen subida')
}

async function loadBrand() {
  const site = siteFilter.value.trim() || 'escarlet'
  const file = brandFile.value
  const data = await api(`/api/admin/brand-kit/${site}/${file}`)
  setBrandValue(data.content || '')
}

brandFile.onchange = loadBrand
document.getElementById('saveBrand').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  const file = brandFile.value
  await api(`/api/admin/brand-kit/${site}/${encodeURIComponent(file)}`, {
    method: 'POST',
    body: JSON.stringify({ content: brandValue() })
  })
  toast('Brand kit guardado')
}

async function loadRefs() {
  const site = siteFilter.value.trim() || 'escarlet'
  const data = await api('/api/admin/media?site=' + site + '&kind=reference')
  renderMediaGrid(refGrid, data.media || [])
}

document.getElementById('refUploadForm').onsubmit = async (e) => {
  e.preventDefault()
  const file = document.getElementById('refFile').files[0]
  if (!file) return
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
}

async function loadSite() {
  const site = siteFilter.value.trim() || 'escarlet'
  if (siteLabel) siteLabel.textContent = site
  const data = await api(`/api/admin/site-config/${site}`)
  siteDomain.value = data.config?.domain || ''
  siteWebhook.value = data.config?.rebuildWebhookUrl || ''
  humanApprovalRequired = Boolean(data.config?.requiresHumanApproval)
  siteHumanApproval.checked = humanApprovalRequired
  siteCoolifyToken.value = ''
  siteTokenStatus.textContent = data.config?.hasCoolifyApiToken
    ? `Token guardado (${data.config.coolifyApiTokenHint}). Deja el campo vacío para mantenerlo.`
    : 'Sin token. Coolify puede rechazar el webhook sin autenticación.'
  rebuildResult.textContent = ''
  rebuildResult.classList.remove('is-ok', 'is-error')
  setPublishLabels(form?.status?.value || 'draft')
}

document.getElementById('saveSite').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  const payload = {
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
    ? `Token guardado (${data.config.coolifyApiTokenHint}). Deja el campo vacío para mantenerlo.`
    : 'Sin token. Coolify puede rechazar el webhook sin autenticación.'
  toast('Sitio guardado')
  humanApprovalRequired = Boolean(siteHumanApproval.checked)
  setPublishLabels(form?.status?.value || 'draft')
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
