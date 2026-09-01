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
const bodyPreview = document.getElementById('bodyPreview')
let brandEditor = null
let token = localStorage.getItem('escarlet_cms_token') || ''

function toast(message) {
  toastEl.hidden = false
  toastEl.textContent = message
  clearTimeout(toastEl._t)
  toastEl._t = setTimeout(() => { toastEl.hidden = true }, 3200)
}

function mediaSrc(item) {
  const path = item.path || ''
  if (path.startsWith('/media/')) return path
  const url = item.url || ''
  if (url.startsWith('/media/')) return url
  const match = url.match(/(\/media\/[^\s?#]+)/)
  return match ? match[1] : url
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
    const caption = document.createElement('p')
    caption.textContent = item.alt || item.filename || src
    div.append(img, caption)
    target.appendChild(div)
  }
}

function ensureBrandEditor() {
  if (brandEditor || typeof EasyMDE === 'undefined') return brandEditor
  brandEditor = new EasyMDE({
    element: brandContent,
    spellChecker: false,
    status: false,
    minHeight: '280px',
    toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'unordered-list', 'ordered-list', '|', 'preview', 'side-by-side', 'fullscreen']
  })
  return brandEditor
}

function brandValue() {
  return brandEditor ? brandEditor.value() : brandContent.value
}

function setBrandValue(text) {
  ensureBrandEditor()
  if (brandEditor) brandEditor.value(text || '')
  else brandContent.value = text || ''
}

function updateBodyPreview() {
  bodyPreview.innerHTML = form.bodyHtml.value || ''
}

function authHeaders() {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || res.statusText)
  return data
}

function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'))
  document.getElementById('panel-' + tab)?.classList.add('active')
  if (tab === 'brand') ensureBrandEditor()
}

async function afterLogin() {
  login.hidden = true
  app.hidden = false
  await loadPosts()
  await loadMedia()
  await loadBrand()
  await loadRefs()
  await loadSite()
  ensureBrandEditor()
  updateBodyPreview()
}

document.getElementById('enter').onclick = async () => {
  token = tokenInput.value.trim()
  await api('/api/login', { method: 'POST', body: JSON.stringify({ token }) })
  localStorage.setItem('escarlet_cms_token', token)
  await afterLogin()
}

document.getElementById('logout').onclick = () => {
  token = ''
  localStorage.removeItem('escarlet_cms_token')
  login.hidden = false
  app.hidden = true
  tokenInput.value = ''
}

if (token) {
  tokenInput.value = token
  afterLogin().catch(() => { login.hidden = false; app.hidden = true })
}

document.querySelectorAll('.nav-btn[data-tab]').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab)
})

async function loadPosts() {
  const site = siteFilter.value.trim() || 'escarlet'
  const status = statusFilter.value
  const q = new URLSearchParams({ site })
  if (status) q.set('status', status)
  const data = await api('/api/admin/posts?' + q)
  list.innerHTML = ''
  const posts = data.posts || []
  if (!posts.length) {
    list.innerHTML = '<li class="empty">No hay posts con este filtro.</li>'
    return
  }
  for (const p of posts) {
    const li = document.createElement('li')
    li.className = 'post-item'
    li.innerHTML = `<div><strong>${p.title}</strong><span class="badge ${p.status}">${p.status}</span><div class="post-meta">${p.slug}</div></div>`
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
    actions.append(edit, prev)
    li.appendChild(actions)
    list.appendChild(li)
  }
}

function fillForm(p) {
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
  updateBodyPreview()
  switchTab('editor')
}

function openPreview(p) {
  const site = siteFilter.value.trim() || 'escarlet'
  const url = `/preview/${site}/${encodeURIComponent(p.slug)}?token=${encodeURIComponent(token)}`
  previewUrl.innerHTML = `<a href="${url}" target="_blank" rel="noopener">${location.origin}${url}</a>`
  previewFrame.src = url
  switchTab('preview')
}

document.getElementById('reloadPosts').onclick = loadPosts
statusFilter.onchange = loadPosts
siteFilter.onchange = () => { loadPosts(); loadMedia(); loadBrand(); loadRefs(); loadSite() }
form.bodyHtml.addEventListener('input', updateBodyPreview)

document.getElementById('newPost').onclick = () => {
  form.reset()
  form.authorName.value = 'Silvia'
  form.status.value = 'draft'
  updateBodyPreview()
  switchTab('editor')
}

form.onsubmit = async (e) => {
  e.preventDefault()
  const site = siteFilter.value.trim() || 'escarlet'
  const payload = {
    site,
    slug: form.slug.value.trim(),
    title: form.title.value.trim(),
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
    bodyHtml: form.bodyHtml.value
  }
  await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(payload) })
  await loadPosts()
  toast('Post guardado')
}

document.getElementById('validateSeo').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  const data = await api('/api/admin/validate-seo', { method: 'POST', body: JSON.stringify({ site, slug }) })
  seoResult.textContent = JSON.stringify(data, null, 2)
}

document.getElementById('publishPost').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  const slug = form.slug.value.trim()
  try {
    const data = await api('/api/admin/posts/publish', { method: 'POST', body: JSON.stringify({ site, slug }) })
    seoResult.textContent = JSON.stringify(data, null, 2)
    await loadPosts()
    const rebuildMsg = data.rebuild
      ? (data.rebuild.ok ? 'Publicado. Rebuild OK.' : `Publicado. Rebuild falló. ${data.rebuild.message}`)
      : (data.message || 'Publicado')
    toast(rebuildMsg)
  } catch (err) {
    toast(err.message)
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
  if (data.media) form.imageUrl.value = mediaSrc(data.media)
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
  const data = await api(`/api/admin/site-config/${site}`)
  siteDomain.value = data.config?.domain || ''
  siteWebhook.value = data.config?.rebuildWebhookUrl || ''
  siteHumanApproval.checked = Boolean(data.config?.requiresHumanApproval)
  siteCoolifyToken.value = ''
  siteTokenStatus.textContent = data.config?.hasCoolifyApiToken
    ? `Token guardado (${data.config.coolifyApiTokenHint}). Deja el campo vacío para mantenerlo.`
    : 'Sin token. Coolify puede rechazar el webhook sin autenticación.'
  rebuildResult.textContent = ''
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
}

document.getElementById('testRebuild').onclick = async () => {
  const site = siteFilter.value.trim() || 'escarlet'
  rebuildResult.textContent = 'Probando webhook…'
  try {
    const data = await api(`/api/admin/site-config/${site}/test-rebuild`, { method: 'POST', body: '{}' })
    rebuildResult.textContent = JSON.stringify(data.rebuild, null, 2)
  } catch (err) {
    rebuildResult.textContent = err.message
  }
}
