import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readDb,
  writeDb,
  publicPost,
  findPost,
  upsertPost,
  mediaDir,
  dataDir
} from './lib/db.mjs'
import {
  loadSiteConfig,
  listSiteHandles,
  saveSiteConfig,
  publicSiteConfig
} from './lib/site-config.mjs'
import {
  getBrandContext,
  getSeoContext,
  readBrandFile,
  writeBrandFile,
  seedAllBrandKits,
  BRAND_FILES,
  BRAND_FILE_LABELS
} from './lib/brand-kit.mjs'
import { validatePostSeo } from './lib/seo-validator.mjs'
import { notifyRebuild, saveUploadedMedia, publishPost as cmsPublishPost, validateSeo as cmsValidateSeo } from './lib/cms-ops.mjs'
import { mediaForClient, repairMediaInDb, repairPostsInDb, resolveImageSrc, resolvePostImageSrc } from './lib/media-url.mjs'
import { withPostLinks } from './lib/preview-url.mjs'
import { escapeHtml, renderPostBody } from './lib/content-render.mjs'
import { handleMcpHttp, sendMcpCors } from './mcp/http-handler.mjs'
import {
  buildDraftPost,
  normalizeAuthor,
  pickRelated,
  toSlug,
  todayIso,
  validateSlug
} from './lib/post-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = __dirname

function loadEnv() {
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const idx = trimmed.indexOf('=')
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

const PORT = Number(process.env.PORT || 3040)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cambia-esto'
const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'
const CMS_PUBLIC_URL = (process.env.CMS_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '')

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  })
  res.end(body)
}

function html(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    ...extraHeaders
  })
  res.end(body)
}

function isAdmin(req, url) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const cookie = String(req.headers.cookie || '')
  const cookieToken = cookie.match(/(?:^|;\s*)escarlet_cms=([^;]+)/)?.[1]
  const queryToken = url.searchParams.get('token') || ''
  const expected = process.env.ADMIN_TOKEN || ADMIN_TOKEN
  return token === expected || cookieToken === expected || queryToken === expected
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('JSON inválido'))
      }
    })
  })
}

function serveStaticFile(res, filePath, contentType) {
  if (!existsSync(filePath)) {
    json(res, 404, { message: 'No encontrado' })
    return
  }
  res.writeHead(200, { 'Content-Type': contentType })
  res.end(readFileSync(filePath))
}

function renderPreview(post, siteConfig, site) {
  const canonical = `${siteConfig.domain.replace(/\/$/, '')}/blog/${post.slug}`
  const imageSrc = resolvePostImageSrc(post.imageUrl, site)
  const imageBlock = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(post.imageAlt || '')}" />`
    : ''
  const body = renderPostBody(post.bodyHtml)
  const canPublish = post.status !== 'published'
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeHtml(post.title)} (preview)</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 0 auto; padding: 1rem; color: #222; line-height: 1.6; }
    .review-bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: space-between; background: #15291f; color: #fff; padding: 0.75rem 1rem; margin: -1rem -1rem 1rem; }
    .review-bar span { font-size: 0.85rem; }
    .review-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .review-actions a, .review-actions button { border: 0; border-radius: 8px; padding: 0.45rem 0.8rem; font: inherit; font-size: 0.85rem; cursor: pointer; text-decoration: none; }
    .review-actions button { background: #52b788; color: #15291f; font-weight: 600; }
    .review-actions a { background: rgba(255,255,255,0.12); color: #fff; }
    .badge { display: inline-block; background: #1f4d3a; color: #fff; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; margin-bottom: 1rem; }
    img { width: 100%; max-width: 100%; height: auto; border-radius: 8px; margin: 1rem 0; display: block; }
    h1 { font-size: 1.8rem; line-height: 1.2; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; word-break: break-word; }
    article h1, article h2, article h3 { margin-top: 1.5rem; line-height: 1.25; }
    article p { margin: 0.75rem 0; }
    article ul, article ol { padding-left: 1.25rem; }
    article blockquote { border-left: 3px solid #ccc; margin: 1rem 0; padding-left: 1rem; color: #444; }
    #publishMsg { width: 100%; font-size: 0.82rem; margin: 0.35rem 0 0; color: #dce8e0; }
  </style>
</head>
<body>
  <div class="review-bar">
    <span>Preview · ${escapeHtml(post.status)}</span>
    <div class="review-actions">
      ${canPublish ? '<button type="button" id="publishBtn">Publicar</button>' : ''}
      <a href="/">Dashboard</a>
    </div>
    <p id="publishMsg" hidden></p>
  </div>
  <h1>${escapeHtml(post.title)}</h1>
  <p class="meta">${escapeHtml(post.authorName)} · ${escapeHtml(post.datePublished)} · ${escapeHtml(canonical)}</p>
  ${imageBlock}
  <p><strong>${escapeHtml(post.excerptEs || '')}</strong></p>
  <article>${body}</article>
  <script>
    (function () {
      const token = new URLSearchParams(location.search).get('token') || ''
      const btn = document.getElementById('publishBtn')
      const msg = document.getElementById('publishMsg')
      if (!btn) return
      btn.addEventListener('click', async () => {
        btn.disabled = true
        msg.hidden = false
        msg.textContent = 'Publicando…'
        try {
          const res = await fetch('/api/admin/posts/publish', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ site: ${JSON.stringify(site)}, slug: ${JSON.stringify(post.slug)} })
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.message || 'No se pudo publicar')
          msg.textContent = data.message || 'Publicado'
          setTimeout(() => location.reload(), 700)
        } catch (error) {
          msg.textContent = error.message
          btn.disabled = false
        }
      })
    })()
  </script>
</body>
</html>`
}

function normalizePostForClient(post) {
  if (!post) return post
  return { ...post, imageUrl: resolvePostImageSrc(post.imageUrl, post.site || 'escarlet') || resolveImageSrc(post.imageUrl) }
}

function normalizePostsForClient(posts) {
  return (posts || []).map(normalizePostForClient)
}

function serveAdmin(res) {
  serveStaticFile(res, join(root, 'admin.html'), 'text/html; charset=utf-8')
}

function servePublic(res, filePath, contentType) {
  serveStaticFile(res, join(root, 'public', filePath), contentType)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (req.method === 'OPTIONS') {
    sendMcpCors(res)
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-Id',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    })
    res.end()
    return
  }

  if (path.startsWith('/.well-known/oauth')) {
    json(res, 404, { message: 'OAuth no usado. Usa Authorization Bearer con ADMIN_TOKEN.' })
    return
  }

  if (path === '/mcp') {
    if (!isAdmin(req, url)) {
      sendMcpCors(res)
      json(res, 401, { message: 'No autorizado. Authorization Bearer con ADMIN_TOKEN.' })
      return
    }
    try {
      const parsedBody = req.method === 'POST' ? await parseBody(req) : undefined
      await handleMcpHttp(req, res, parsedBody)
    } catch (error) {
      if (!res.headersSent) json(res, 400, { message: error.message })
    }
    return
  }

  if (req.method === 'GET' && path === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('User-agent: *\nDisallow: /\n')
    return
  }

  if (req.method === 'GET' && (path === '/admin' || path === '/')) {
    serveAdmin(res)
    return
  }

  if (req.method === 'GET' && path === '/favicon.svg') {
    servePublic(res, 'favicon.svg', 'image/svg+xml')
    return
  }

  if (req.method === 'GET' && path === '/favicon.ico') {
    servePublic(res, 'favicon.svg', 'image/svg+xml')
    return
  }

  if (req.method === 'GET' && path === '/admin.css') {
    servePublic(res, 'admin.css', 'text/css; charset=utf-8')
    return
  }

  if (req.method === 'GET' && path === '/admin.js') {
    servePublic(res, 'admin.js', 'application/javascript; charset=utf-8')
    return
  }

  const mediaMatch = path.match(/^\/media\/([^/]+)(?:\/reference)?\/([^/]+)$/)
  if (req.method === 'GET' && mediaMatch) {
    const [, site, filename] = mediaMatch
    const isRef = path.includes('/reference/')
    const filePath = join(mediaDir, isRef ? join(site, 'reference') : site, filename)
    const ext = extname(filename).toLowerCase()
    const types = {
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    }
    serveStaticFile(res, filePath, types[ext] || 'application/octet-stream')
    return
  }

  const previewMatch = path.match(/^\/preview\/([^/]+)\/([^/]+)$/)
  if (req.method === 'GET' && previewMatch) {
    if (!isAdmin(req, url)) {
      json(res, 401, { message: 'Token requerido para preview' })
      return
    }
    const [, site, slug] = previewMatch
    const db = readDb()
    const post = findPost(db, site, decodeURIComponent(slug))
    if (!post) {
      json(res, 404, { message: 'Post no encontrado' })
      return
    }
    const siteConfig = loadSiteConfig(site) || { domain: 'https://escarlet.design' }
    html(res, 200, renderPreview(post, siteConfig, site))
    return
  }

  if (req.method === 'POST' && path === '/api/login') {
    try {
      const body = await parseBody(req)
      const expected = process.env.ADMIN_TOKEN || ADMIN_TOKEN
      if (body.token !== expected) {
        json(res, 401, { message: 'Token incorrecto' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `escarlet_cms=${expected}; Path=/; HttpOnly; SameSite=Lax`
      })
      res.end(JSON.stringify({ ok: true }))
    } catch (error) {
      json(res, 400, { message: error.message })
    }
    return
  }

  if (req.method === 'GET' && path === '/api/health') {
    json(res, 200, { ok: true, version: '2.0.0', mcp: '/mcp' })
    return
  }

  if (req.method === 'GET' && path === '/api/sites') {
    const db = readDb()
    const handles = listSiteHandles()
    const configured = handles.map((h) => loadSiteConfig(h)).filter(Boolean)
    json(res, 200, { sites: db.sites || [], configured })
    return
  }

  const siteMatch = path.match(/^\/api\/sites\/([^/]+)\/posts(?:\/([^/]+))?$/)
  if (siteMatch && req.method === 'GET') {
    const site = siteMatch[1]
    const slug = siteMatch[2]
    const db = readDb()
    const published = db.posts.filter((p) => p.site === site && p.status === 'published')
    if (slug) {
      const post = published.find((p) => p.slug === slug)
      if (!post) {
        json(res, 404, { message: 'No encontrado' })
        return
      }
      json(res, 200, { site, post: publicPost(post) })
      return
    }
    json(res, 200, { site, posts: published.map(publicPost) })
    return
  }

  if (path.startsWith('/api/admin')) {
    if (!isAdmin(req, url)) {
      json(res, 401, { message: 'No autorizado' })
      return
    }

    const db = readDb()

    if (req.method === 'GET' && path === '/api/admin/posts') {
      const site = url.searchParams.get('site') || DEFAULT_SITE
      const status = url.searchParams.get('status')
      let posts = db.posts.filter((p) => p.site === site)
      if (status) posts = posts.filter((p) => p.status === status)
      json(res, 200, { posts: normalizePostsForClient(posts) })
      return
    }

    const adminPostMatch = path.match(/^\/api\/admin\/posts\/([^/]+)$/)
    if (req.method === 'GET' && adminPostMatch) {
      const site = url.searchParams.get('site') || DEFAULT_SITE
      const slug = decodeURIComponent(adminPostMatch[1])
      const post = findPost(db, site, slug)
      if (!post) {
        json(res, 404, { message: 'No encontrado' })
        return
      }
      json(res, 200, { post: normalizePostForClient(post) })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/sites') {
      json(res, 200, { sites: db.sites || [], handles: listSiteHandles() })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/authors') {
      json(res, 200, { authors: db.authors || [] })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/categories') {
      json(res, 200, { categories: db.categories || [] })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/media') {
      const site = url.searchParams.get('site') || DEFAULT_SITE
      const kind = url.searchParams.get('kind')
      let items = (db.media || []).filter((m) => !m.site || m.site === site)
      if (kind) items = items.filter((m) => m.kind === kind)
      json(res, 200, { media: items.map(mediaForClient) })
      return
    }

    const siteConfigTestMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)\/test-rebuild$/)
    if (siteConfigTestMatch && req.method === 'POST') {
      const handle = siteConfigTestMatch[1]
      if (!loadSiteConfig(handle)) {
        json(res, 404, { message: 'Site no encontrado' })
        return
      }
      const rebuild = await notifyRebuild(handle)
      json(res, rebuild.ok ? 200 : 502, { rebuild })
      return
    }

    const siteConfigMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)$/)
    if (siteConfigMatch) {
      const handle = siteConfigMatch[1]
      if (req.method === 'GET') {
        const config = loadSiteConfig(handle)
        if (!config) {
          json(res, 404, { message: 'Site no encontrado' })
          return
        }
        json(res, 200, { config: publicSiteConfig(config) })
        return
      }
      if (req.method === 'POST') {
        const body = await parseBody(req)
        const partial = {
          name: body.name,
          domain: body.domain,
          rebuildWebhookUrl: body.rebuildWebhookUrl,
          requiresHumanApproval: body.requiresHumanApproval
        }
        if (body.coolifyApiToken) partial.coolifyApiToken = body.coolifyApiToken
        if (body.clearCoolifyApiToken) partial.clearCoolifyApiToken = true
        const config = saveSiteConfig(handle, partial)
        json(res, 200, { config: publicSiteConfig(config) })
        return
      }
    }

    const brandMatch = path.match(/^\/api\/admin\/brand-kit\/([^/]+)(?:\/([^/]+))?$/)
    if (brandMatch) {
      const site = brandMatch[1]
      const file = brandMatch[2] ? decodeURIComponent(brandMatch[2]) : ''
      const allowed = !file || BRAND_FILES.includes(file) || file === 'agent-rules.md'
      if (req.method === 'GET' && !file) {
        json(res, 200, { ...getBrandContext(site), files: BRAND_FILES, labels: BRAND_FILE_LABELS })
        return
      }
      if (req.method === 'GET' && file && allowed) {
        json(res, 200, { site, file, content: readBrandFile(site, file) })
        return
      }
      if (req.method === 'POST' && file && allowed) {
        try {
          const body = await parseBody(req)
          writeBrandFile(site, file, body.content || '')
          json(res, 200, { ok: true, file })
        } catch (err) {
          json(res, 400, { message: err.message })
        }
        return
      }
    }

    if (req.method === 'POST' && path === '/api/admin/validate-seo') {
      const body = await parseBody(req)
      const site = body.site || DEFAULT_SITE
      try {
        const result = await cmsValidateSeo(site, body.slug, body.post)
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media/upload') {
      const body = await parseBody(req)
      if (!body.filename || (!body.contentBase64 && !body.imageUrl)) {
        json(res, 400, { message: 'Faltan filename y contentBase64 o imageUrl' })
        return
      }
      try {
        const item = await saveUploadedMedia({
          site: body.site || DEFAULT_SITE,
          filename: body.filename,
          contentBase64: body.contentBase64,
          imageUrl: body.imageUrl,
          alt: body.alt || '',
          kind: body.kind || 'post'
        })
        json(res, 200, { media: item })
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media') {
      const body = await parseBody(req)
      const item = {
        id: body.id || `media-${Date.now()}`,
        site: body.site || DEFAULT_SITE,
        url: body.url || '',
        alt: body.alt || ''
      }
      db.media = db.media || []
      db.media.push(item)
      writeDb(db)
      json(res, 200, { media: item })
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/create-draft') {
      const body = await parseBody(req)
      const site = body.site || DEFAULT_SITE
      const siteConfig = loadSiteConfig(site)
      const title = String(body.title || '').trim()
      if (!title) {
        json(res, 400, { message: 'Falta title' })
        return
      }
      const slug = toSlug(body.slug || title)
      validateSlug(slug)
      if (findPost(db, site, slug)) {
        json(res, 409, { message: `Ya existe slug ${slug}` })
        return
      }
      const author = normalizeAuthor(body.author || body.authorName, siteConfig?.authors)
      const date = body.date || todayIso()
      const existingSlugs = db.posts.filter((p) => p.site === site).map((p) => p.slug)
      const relatedSlugs = pickRelated(existingSlugs, slug, siteConfig?.seo?.relatedSlugsCount || 3)
      const draft = buildDraftPost({
        site,
        slug,
        title,
        author,
        date,
        domain: siteConfig?.domain || 'https://escarlet.design',
        relatedSlugs
      })
      upsertPost(db, draft)
      writeDb(db)
      json(res, 201, withPostLinks({
        post: draft,
        reminder: getBrandContext(site).reminder
      }, site, slug))
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts') {
      const body = await parseBody(req)
      const site = body.site || DEFAULT_SITE
      const slug = body.slug
      if (!slug) {
        json(res, 400, { message: 'Falta slug' })
        return
      }
      const existing = findPost(db, site, slug)
      const post = {
        id: slug,
        site,
        status: body.status || existing?.status || 'draft',
        dateModified: todayIso(),
        ...existing,
        ...body
      }
      upsertPost(db, post)
      writeDb(db)
      let rebuild = null
      if (post.status === 'published') rebuild = await notifyRebuild(site)
      json(res, 200, withPostLinks({ post, rebuild }, site, slug))
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/publish') {
      const body = await parseBody(req)
      const site = body.site || DEFAULT_SITE
      const slug = body.slug
      try {
        const result = await cmsPublishPost(site, slug)
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'DELETE') {
      const del = path.match(/^\/api\/admin\/posts\/([^/]+)$/)
      if (del) {
        const site = url.searchParams.get('site') || DEFAULT_SITE
        const slug = decodeURIComponent(del[1])
        db.posts = db.posts.filter((p) => !(p.site === site && p.slug === slug))
        writeDb(db)
        json(res, 200, { ok: true })
        return
      }
    }
  }

  json(res, 404, { message: 'Ruta no encontrada' })
})

mkdirSync(dataDir, { recursive: true })
mkdirSync(mediaDir, { recursive: true })
seedAllBrandKits()

const dbBoot = readDb()
let dbRepaired = repairMediaInDb(dbBoot)
if (repairPostsInDb(dbBoot)) dbRepaired = true
if (dbRepaired) writeDb(dbBoot)

server.listen(PORT, () => {
  console.log(`Escarlet blog CMS en http://localhost:${PORT}/admin`)
  console.log(`MCP remoto (Hermes) en http://localhost:${PORT}/mcp`)
})

export { ADMIN_TOKEN, DEFAULT_SITE, CMS_PUBLIC_URL }
