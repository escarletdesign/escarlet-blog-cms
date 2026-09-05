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
  dataDir,
  getPersistenceStatus,
  markPersistent,
  checkDataWritable
} from './lib/db.mjs'
import {
  loadSiteConfig,
  listSiteHandles,
  saveSiteConfig,
  publicSiteConfig,
  getSocialPackChannels,
  isPublicBlogEnabled,
  isAgencyGate
} from './lib/site-config.mjs'
import {
  getBrandContext,
  getSeoContext,
  readBrandFile,
  writeBrandFile,
  seedAllBrandKits,
  importBrandKitZip,
  BRAND_ALL_FILES,
  BRAND_FILE_LABELS,
  assertBrandFileAccess,
  brandFilesForAuth,
  brandLabelsForAuth
} from './lib/brand-kit.mjs'
import { validatePostSeo } from './lib/seo-validator.mjs'
import {
  resolveRequestAuth,
  publicAuthSession,
  assertSiteAccess,
  assertSuperAdmin,
  assertAgencyOps,
  allowedSiteHandles,
  canAccessSite,
  isSuperAdmin,
  isAgencyOrAdmin,
  isSiteScopedRole,
  generateSiteAccessToken,
  publicSiteConfigForAuth,
  extractBearerOrCookie
} from './lib/auth.mjs'
import {
  createEmbedSession,
  consumeEmbedSession,
  sanitizeNext,
  frameAncestorsHeader
} from './lib/embed-session.mjs'
import {
  createMagicToken,
  consumeMagicToken,
  createSessionBearer,
  createReviewToken,
  consumeReviewToken
} from './lib/access-tokens.mjs'
import { sendMagicLinkEmail } from './lib/magic-email.mjs'
import { isProductRestructureV1 } from './lib/product-flags.mjs'
import {
  notifyRebuild,
  uploadMedia,
  receiveImageDrop,
  publishPost as cmsPublishPost,
  validateSeo as cmsValidateSeo,
  deleteMedia as cmsDeleteMedia,
  updatePost as cmsUpdatePost,
  unpublishPost as cmsUnpublishPost,
  deletePost as cmsDeletePost,
  createSiteRecord,
  getOnboarding,
  schedulePostForDate as cmsSchedulePost,
  confirmSchedule as cmsConfirmSchedule,
  cancelSchedule as cmsCancelSchedule,
  listCalendarPosts as cmsListCalendar,
  promoteDueScheduledPosts,
  requestPostChanges as cmsRequestPostChanges,
  applyReviewLinkAction as cmsApplyReviewLinkAction
} from './lib/cms-ops.mjs'
import { mediaForClient, repairMediaInDb, repairPostsInDb, resolveImageSrc, resolvePostImageSrc, inspectImageBuffer } from './lib/media-url.mjs'
import { parseMultipart, isMultipartRequest } from './lib/multipart.mjs'
import { withPostLinks } from './lib/preview-url.mjs'
import { escapeHtml, renderPostBody } from './lib/content-render.mjs'
import { handleMcpHttp, sendMcpCors } from './mcp/http-handler.mjs'
import { MCP_SERVER_VERSION, MEDIA_UPLOAD_TOOL } from './lib/media-upload-contract.mjs'
import {
  RUNTIME_CHANNEL,
  getRuntimeManifest,
  getRuntimeFile
} from './lib/frontend-runtime.mjs'
import {
  isCmsSocialPackHostEnabled,
  buildSocialPackPayload,
  listSocialPackSummaries,
  renderSocialPackPageHtml,
  renderSocialPackIndexHtml
} from './lib/social-pack-host.mjs'
import {
  getMcpConnectionInfo,
  prepareSiteAgentIcon,
  readSiteAgentIcon
} from './lib/favicon.mjs'
import {
  authorizationServerMetadata,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleRegister,
  handleToken,
  isValidAccessToken,
  parseFormBody,
  protectedResourceMetadata,
  wwwAuthenticateHeader
} from './lib/oauth-mcp.mjs'
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
  return Boolean(resolveRequestAuth(req, url))
}

function requireAuth(req, url, res) {
  const auth = resolveRequestAuth(req, url)
  if (!auth) {
    json(res, 401, { message: 'No autorizado' })
    return null
  }
  return auth
}

function siteFrom(auth, preferred) {
  if (isSiteScopedRole(auth.role)) return auth.site
  return preferred || DEFAULT_SITE
}

const MAX_BODY_BYTES = 15 * 1024 * 1024

function readRawBuffer(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) {
        req.destroy()
        reject(Object.assign(new Error('La subida supera 15 MB'), { status: 413 }))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseBody(req) {
  return readRawBuffer(req).then((buf) => {
    if (!buf.length) return {}
    if (isMultipartRequest(req)) {
      const parsed = parseMultipart(buf, req.headers['content-type'])
      return {
        ...parsed.fields,
        filename: parsed.fields.filename || parsed.file?.filename,
        buffer: parsed.file?.buffer
      }
    }
    const raw = buf.toString('utf8')
    const type = String(req.headers['content-type'] || '')
    if (type.includes('application/x-www-form-urlencoded')) return parseFormBody(raw)
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error('JSON inválido')
    }
  })
}

function serveStaticFile(
  res,
  filePath,
  contentType,
  method = 'GET',
  cacheControl = 'public, max-age=3600',
  extraHeaders = {}
) {
  if (!existsSync(filePath)) {
    json(res, 404, { message: 'No encontrado' })
    return
  }
  const data = readFileSync(filePath)
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': data.length,
    'Cache-Control': cacheControl,
    ...extraHeaders
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  res.end(data)
}

function serveAdmin(res, extraHeaders = {}) {
  serveStaticFile(
    res,
    join(root, 'admin.html'),
    'text/html; charset=utf-8',
    'GET',
    'no-store, no-cache, must-revalidate',
    extraHeaders
  )
}

function absoluteCmsOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http'
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`)
    .split(',')[0]
    .trim()
  return `${proto}://${host}`
}

function embedBootstrapHtml({ token, next }) {
  const safeToken = JSON.stringify(String(token || ''))
  const safeNext = JSON.stringify(sanitizeNext(next))
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Entrando al CMS…</title>
</head>
<body>
  <p>Abriendo el panel Escarlet…</p>
  <script>
    (function () {
      var token = ${safeToken};
      var next = ${safeNext};
      try {
        localStorage.setItem('escarlet_cms_token', token);
      } catch (e) {}
      location.replace('/admin' + (next || '#/entradas'));
    })();
  </script>
</body>
</html>`
}

function servePublic(res, filePath, contentType, cacheControl = 'public, max-age=3600') {
  serveStaticFile(res, join(root, 'public', filePath), contentType, 'GET', cacheControl)
}

function renderPreview(post, siteConfig, site) {
  const canonical = `${siteConfig.domain.replace(/\/$/, '')}/blog/${post.slug}`
  const imageSrc = resolvePostImageSrc(post.imageUrl, site)
  let imageBlock = ''
  if (imageSrc) {
    const disk = join(mediaDir, imageSrc.replace(/^\/media\//, ''))
    if (existsSync(disk) && readFileSync(disk).length >= 1024) {
      imageBlock = `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(post.imageAlt || '')}" />`
    } else {
      imageBlock = `<p class="meta">Portada no disponible. El archivo falta o está corrupto (${escapeHtml(imageSrc)}). Súbelo de nuevo en Media.</p>`
    }
  } else if (post.imageUrl) {
    imageBlock = `<p class="meta">Portada no encontrada para ${escapeHtml(post.imageUrl)}. Súbela de nuevo en Media.</p>`
  }
  const body = renderPostBody(post.bodyHtml)
  const canPublish = post.status !== 'published'
  const publishLabel = post.status === 'review' ? 'Publicar en vivo' : 'Enviar a revisión'
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
    #publishMsg { width: 100%; font-size: 0.9rem; line-height: 1.45; margin: 0.5rem 0 0; color: #dce8e0; }
    #publishMsg.is-review { color: #ffe8a3; }
    #publishMsg.is-ok { color: #b7f0d0; }
    #publishMsg.is-error { color: #ffb4a8; }
  </style>
</head>
<body>
  <div class="review-bar">
    <span>Preview · ${escapeHtml(post.status)}${post.status === 'review' ? ' · pendiente de publicar en vivo' : ''}</span>
    <div class="review-actions">
      ${canPublish ? `<button type="button" id="publishBtn">${publishLabel}</button>` : ''}
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
          const next = data.submittedForReview
            ? (data.message || 'Enviado a revisión. En el listado aparece como review. Abre Preview otra vez y pulsa Publicar en vivo cuando esté listo.')
            : (data.message || 'Publicado en el blog')
          msg.textContent = next
          msg.className = data.submittedForReview ? 'is-review' : 'is-ok'
          btn.textContent = data.submittedForReview ? 'Publicar en vivo' : 'Publicado'
          if (data.published) {
            btn.disabled = true
            setTimeout(() => location.reload(), 2500)
          } else {
            btn.disabled = false
          }
        } catch (error) {
          msg.textContent = error.message
          msg.className = 'is-error'
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

  if (
    path === '/.well-known/oauth-protected-resource' ||
    path === '/.well-known/oauth-protected-resource/mcp'
  ) {
    json(res, 200, protectedResourceMetadata())
    return
  }

  if (
    path === '/.well-known/oauth-authorization-server' ||
    path === '/.well-known/openid-configuration'
  ) {
    json(res, 200, authorizationServerMetadata())
    return
  }

  if (path === '/oauth/authorize') {
    if (req.method === 'GET') {
      const result = await handleAuthorizeGet(url)
      html(res, result.status, result.html)
      return
    }
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req)
        const result = await handleAuthorizePost(body)
        if (result.location) {
          res.writeHead(result.status, { Location: result.location })
          res.end()
          return
        }
        html(res, result.status, result.html)
      } catch (error) {
        html(res, 400, `<pre>${error.message}</pre>`)
      }
      return
    }
  }

  if (req.method === 'POST' && path === '/oauth/token') {
    try {
      const body = await parseBody(req)
      const result = await handleToken(body)
      json(res, result.status, result.json)
    } catch (error) {
      json(res, 400, { error: 'invalid_request', error_description: error.message })
    }
    return
  }

  if (req.method === 'POST' && path === '/oauth/register') {
    try {
      const body = await parseBody(req)
      const result = await handleRegister(body)
      json(res, result.status, result.json)
    } catch (error) {
      json(res, 400, { error: 'invalid_client_metadata', error_description: error.message })
    }
    return
  }

  if (path === '/mcp') {
    const auth = resolveRequestAuth(req, url)
    if (!auth) {
      sendMcpCors(res)
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        'WWW-Authenticate': wwwAuthenticateHeader(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-Id',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate'
      })
      res.end(
        JSON.stringify({
          message: 'No autorizado. Usa Bearer ADMIN_TOKEN, token de sitio o OAuth (ChatGPT).'
        })
      )
      return
    }
    try {
      const parsedBody = req.method === 'POST' ? await parseBody(req) : undefined
      await handleMcpHttp(req, res, parsedBody, auth)
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

  if (req.method === 'GET' && (path === '/runtime' || path === `/runtime/${RUNTIME_CHANNEL}`)) {
    json(res, 200, getRuntimeManifest())
    return
  }

  const runtimeMatch = path.match(/^\/runtime\/(v\d+)\/(.+)$/)
  if (req.method === 'GET' && runtimeMatch) {
    const [, channel, fileName] = runtimeMatch
    if (channel !== RUNTIME_CHANNEL) {
      json(res, 404, { message: `Canal runtime ${channel} no disponible. Usa ${RUNTIME_CHANNEL}.` })
      return
    }
    if (fileName === 'manifest.json') {
      json(res, 200, getRuntimeManifest())
      return
    }
    const file = getRuntimeFile(fileName)
    if (!file) {
      json(res, 404, { message: 'Archivo runtime no encontrado' })
      return
    }
    res.writeHead(200, {
      'Content-Type': file.contentType,
      'Content-Length': file.body.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(file.body)
    return
  }

  if (req.method === 'GET' && (path === '/admin' || path === '/')) {
    const auth = resolveRequestAuth(req, url)
    const embed = url.searchParams.get('embed') === '1'
    const extra = {}
    if (embed && auth) {
      const domains = []
      if (isSiteScopedRole(auth.role)) {
        const cfg = loadSiteConfig(auth.site)
        if (cfg?.domain) domains.push(cfg.domain)
      } else {
        for (const handle of listSiteHandles()) {
          const cfg = loadSiteConfig(handle)
          if (cfg?.domain) domains.push(cfg.domain)
        }
      }
      extra['Content-Security-Policy'] = frameAncestorsHeader(domains)
    } else {
      // Default harden unless embed=1 with a valid session cookie/token.
      extra['Content-Security-Policy'] = "frame-ancestors 'self'"
    }
    serveAdmin(res, extra)
    return
  }

  // CMS Social Pack host (F2). Takes precedence over any static Vite blog-packs.
  if (isCmsSocialPackHostEnabled() && req.method === 'GET') {
    const packIndex = path === '/admin/blog-packs' || path === '/admin/blog-packs/'
    const packDetail = path.match(/^\/admin\/blog-packs\/([^/]+)\/?$/)
    if (packIndex || packDetail) {
      const auth = requireAuth(req, url, res)
      if (!auth) return
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const siteConfig = loadSiteConfig(site) || { domain: 'https://example.com' }
      const db = readDb()
      const posts = db.posts.filter((p) => p.site === site)
      if (packIndex) {
        const summaries = listSocialPackSummaries(posts, siteConfig, { cmsHostEnabled: true })
        html(res, 200, renderSocialPackIndexHtml(summaries, { siteLabel: site }))
        return
      }
      const slug = decodeURIComponent(packDetail[1])
      if (slug === 'manifest.webmanifest') {
        json(res, 404, { message: 'Manifest Vite no aplica. Social Pack vive en el CMS.' })
        return
      }
      const post = findPost(db, site, slug)
      if (!post) {
        json(res, 404, { message: 'Pack no encontrado' })
        return
      }
      const payload = buildSocialPackPayload(post, siteConfig, {
        cmsHostEnabled: true,
        includeEmpty: true
      })
      html(res, 200, renderSocialPackPageHtml(payload))
      return
    }
  }

  if (req.method === 'POST' && path === '/api/embed/session') {
    try {
      const auth = resolveRequestAuth(req, url)
      if (!auth) {
        json(res, 401, { message: 'No autorizado' })
        return
      }
      const body = await parseBody(req)
      const rawToken = extractBearerOrCookie(req, url)
      const next = sanitizeNext(body.next || body.path || '')
      const session = createEmbedSession({
        token: rawToken,
        site: isSiteScopedRole(auth.role) ? auth.site : body.site || null,
        next
      })
      const origin = absoluteCmsOrigin(req)
      const consumeUrl = `${origin}/api/embed/consume?code=${encodeURIComponent(session.code)}`
      json(res, 200, {
        ok: true,
        consumeUrl,
        expiresAt: new Date(session.expiresAt).toISOString(),
        next: session.next
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (req.method === 'GET' && path === '/api/embed/consume') {
    const code = url.searchParams.get('code') || ''
    const session = consumeEmbedSession(code)
    if (!session) {
      html(res, 400, '<!doctype html><p>El enlace de acceso ha caducado. Vuelve a WordPress y ábrelo otra vez.</p>')
      return
    }
    const cookie = `escarlet_cms=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax`
    html(res, 200, embedBootstrapHtml(session), {
      'Set-Cookie': cookie,
      'Cache-Control': 'no-store'
    })
    return
  }

  // --- Product restructure V1: magic + review links ---
  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/magic/send') {
    try {
      const auth = requireAuth(req, url, res)
      if (!auth) return
      assertAgencyOps(auth)
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const email = String(body.email || '').trim()
      const role = body.role === 'agency_admin' ? 'agency_admin' : 'client'
      const minted = createMagicToken({
        site,
        role,
        email,
        next: sanitizeNext(body.next)
      })
      const origin = absoluteCmsOrigin(req)
      const link = `${origin}/api/magic/consume?token=${encodeURIComponent(minted.token)}`
      const delivery = await sendMagicLinkEmail({ to: email, link, site })
      json(res, 200, {
        ok: true,
        expiresAt: new Date(minted.expiresAt).toISOString(),
        transport: delivery.transport,
        // Ops paste when Resend is unset
        link: delivery.transport === 'console' ? link : undefined
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'GET' && path === '/api/magic/consume') {
    const token = url.searchParams.get('token') || ''
    const result = consumeMagicToken(token, {
      origin: req.headers.origin,
      host: req.headers.host
    })
    if (!result.ok) {
      html(
        res,
        result.status || 410,
        `<!doctype html><p>${escapeHtml(result.message || 'Enlace mágico no válido o caducado.')}</p>`
      )
      return
    }
    const bearer = createSessionBearer({
      site: result.session.site,
      role: result.session.role
    })
    const cookie = `escarlet_cms=${encodeURIComponent(bearer.token)}; Path=/; HttpOnly; SameSite=Lax`
    const next = result.session.next || '#/entradas'
    html(
      res,
      200,
      embedBootstrapHtml({ next, site: result.session.site, token: bearer.token }),
      { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' }
    )
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/review/token') {
    try {
      const auth = requireAuth(req, url, res)
      if (!auth) return
      assertAgencyOps(auth)
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const slug = String(body.slug || '').trim()
      if (!slug) {
        json(res, 400, { message: 'Falta slug' })
        return
      }
      const minted = createReviewToken({
        site,
        slug,
        actions: body.actions
      })
      const origin = absoluteCmsOrigin(req)
      json(res, 200, {
        ok: true,
        token: minted.token,
        expiresAt: new Date(minted.expiresAt).toISOString(),
        consumeUrl: `${origin}/api/review/consume`
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/review/consume') {
    try {
      const body = await parseBody(req)
      const consumed = consumeReviewToken(body.token, {
        action: body.action,
        rejectReason: body.rejectReason,
        expectedSlug: body.slug,
        origin: req.headers.origin,
        host: req.headers.host
      })
      if (!consumed.ok) {
        json(res, consumed.status || 401, { message: consumed.message || 'Review token denied' })
        return
      }
      const result = await cmsApplyReviewLinkAction(consumed.site, consumed.slug, {
        action: consumed.action,
        rejectReason: consumed.rejectReason,
        actor: consumed.actor
      })
      json(res, 200, result)
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
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
    servePublic(res, 'admin.css', 'text/css; charset=utf-8', 'no-store, no-cache, must-revalidate')
    return
  }

  if (req.method === 'GET' && path === '/vendor/pico.conditional.min.css') {
    servePublic(
      res,
      'vendor/pico.conditional.min.css',
      'text/css; charset=utf-8',
      'public, max-age=604800'
    )
    return
  }

  if (req.method === 'GET' && path === '/admin.js') {
    servePublic(res, 'admin.js', 'application/javascript; charset=utf-8', 'no-store, no-cache, must-revalidate')
    return
  }

  const mediaMatch = path.match(/^\/media\/([^/]+)(?:\/reference)?\/([^/]+)$/)
  if ((req.method === 'GET' || req.method === 'HEAD') && mediaMatch) {
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
    serveStaticFile(res, filePath, types[ext] || 'application/octet-stream', req.method)
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
      const auth = resolveRequestAuth(
        { headers: { authorization: `Bearer ${body.token || ''}` } },
        new URL('http://local/')
      )
      if (!auth) {
        json(res, 401, { message: 'Token incorrecto' })
        return
      }
      const session = publicAuthSession(auth)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `escarlet_cms=${encodeURIComponent(body.token)}; Path=/; HttpOnly; SameSite=Lax`
      })
      res.end(JSON.stringify({ ok: true, ...session }))
    } catch (error) {
      json(res, 400, { message: error.message })
    }
    return
  }

  if (req.method === 'GET' && path === '/api/health') {
    const persistence = getPersistenceStatus()
    json(res, persistence.writable ? 200 : 503, {
      ok: persistence.writable,
      version: MCP_SERVER_VERSION,
      mcp: '/mcp',
      mcpUpload: MEDIA_UPLOAD_TOOL,
      persistence
    })
    return
  }

  const inboxMatch = path.match(/^\/api\/media-inbox\/([a-f0-9]+)$/i)
  if (inboxMatch) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'PUT, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const buf = await readRawBuffer(req)
        let buffer = buf
        if (isMultipartRequest(req)) {
          const parsed = parseMultipart(buf, req.headers['content-type'])
          buffer = parsed.file?.buffer || buf
        }
        const result = await receiveImageDrop(inboxMatch[1], buffer)
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }
    json(res, 405, { message: 'Usa PUT con el PNG en el cuerpo' })
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
    const siteConfig = loadSiteConfig(site)
    const socialPackChannels = siteConfig ? getSocialPackChannels(siteConfig) : undefined
    const blogEnabled = isPublicBlogEnabled(siteConfig)
    if (!blogEnabled) {
      if (slug) {
        json(res, 404, { message: 'No encontrado', blogEnabled: false })
        return
      }
      json(res, 200, { site, posts: [], socialPackChannels, blogEnabled: false })
      return
    }
    const published = db.posts.filter((p) => p.site === site && p.status === 'published')
    if (slug) {
      const post = published.find((p) => p.slug === slug)
      if (!post) {
        json(res, 404, { message: 'No encontrado' })
        return
      }
      json(res, 200, { site, post: publicPost(post), socialPackChannels, blogEnabled: true })
      return
    }
    json(res, 200, { site, posts: published.map(publicPost), socialPackChannels, blogEnabled: true })
    return
  }

  if (path.startsWith('/api/admin')) {
    const auth = requireAuth(req, url, res)
    if (!auth) return

    const db = readDb()

    if (req.method === 'GET' && path === '/api/admin/session') {
      json(res, 200, publicAuthSession(auth))
      return
    }

    if (isCmsSocialPackHostEnabled() && req.method === 'GET' && path === '/api/admin/social-pack') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const siteConfig = loadSiteConfig(site) || { domain: 'https://example.com' }
      const posts = db.posts.filter((p) => p.site === site)
      const packs = listSocialPackSummaries(posts, siteConfig, { cmsHostEnabled: true })
      json(res, 200, {
        site,
        source: 'cms',
        socialPackChannels: getSocialPackChannels(siteConfig),
        packs
      })
      return
    }

    const socialPackMatch = path.match(/^\/api\/admin\/social-pack\/([^/]+)$/)
    if (isCmsSocialPackHostEnabled() && req.method === 'GET' && socialPackMatch) {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const slug = decodeURIComponent(socialPackMatch[1])
      const post = findPost(db, site, slug)
      if (!post) {
        json(res, 404, { message: 'Pack no encontrado' })
        return
      }
      const siteConfig = loadSiteConfig(site) || { domain: 'https://example.com' }
      const pack = buildSocialPackPayload(post, siteConfig, {
        cmsHostEnabled: true,
        includeEmpty: true
      })
      json(res, 200, { pack })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/posts') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const status = url.searchParams.get('status')
      let posts = db.posts.filter((p) => p.site === site)
      if (status) posts = posts.filter((p) => p.status === status)
      json(res, 200, { posts: normalizePostsForClient(posts) })
      return
    }

    const adminPostMatch = path.match(/^\/api\/admin\/posts\/([^/]+)$/)
    if (req.method === 'GET' && adminPostMatch) {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
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
      const handles = allowedSiteHandles(auth)
      const sites = (db.sites || []).filter((s) => handles.includes(s.handle || s.id))
      json(res, 200, {
        sites,
        handles,
        role: auth.role,
        canCreateSites: isSuperAdmin(auth)
      })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/onboarding') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      json(res, 200, await getOnboarding(site))
      return
    }

    if (req.method === 'POST' && path === '/api/admin/sites') {
      try {
        assertSuperAdmin(auth)
        const body = await parseBody(req)
        const result = await createSiteRecord(body)
        json(res, 201, result)
      } catch (err) {
        json(res, err.status || 500, { message: err.message, ...(err.extra || {}) })
      }
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
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const kind = url.searchParams.get('kind')
      let items = (db.media || []).filter((m) => !m.site || m.site === site)
      if (kind) items = items.filter((m) => m.kind === kind)
      const media = items.map((item) => {
        const client = mediaForClient(item)
        const disk = client.path?.startsWith('/media/')
          ? join(mediaDir, client.path.replace(/^\/media\//, ''))
          : ''
        let bytes = 0
        let ok = false
        let integrity = { reason: 'missing' }
        if (disk && existsSync(disk)) {
          const buf = readFileSync(disk)
          bytes = buf.length
          integrity = inspectImageBuffer(buf)
          ok = integrity.ok
        }
        return { ...client, bytes, ok, integrity }
      })
      json(res, 200, { media })
      return
    }

    const siteConfigTestMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)\/test-rebuild$/)
    if (siteConfigTestMatch && req.method === 'POST') {
      const handle = siteConfigTestMatch[1]
      try {
        assertSiteAccess(auth, handle)
        assertAgencyOps(auth)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      if (!loadSiteConfig(handle)) {
        json(res, 404, { message: 'Site no encontrado' })
        return
      }
      const rebuild = await notifyRebuild(handle)
      json(res, rebuild.ok ? 200 : 502, {
        rebuild,
        message: rebuild.message || (rebuild.ok ? 'Rebuild disparado' : 'Webhook falló')
      })
      return
    }

    const siteTokenMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)\/access-token$/)
    if (siteTokenMatch && req.method === 'POST') {
      const handle = siteTokenMatch[1]
      try {
        assertSuperAdmin(auth)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const siteCfg = loadSiteConfig(handle)
      if (!siteCfg) {
        json(res, 404, { message: 'Site no encontrado' })
        return
      }
      const body = await parseBody(req).catch(() => ({}))
      if (body.clear) {
        const config = saveSiteConfig(handle, { clearSiteAccessToken: true })
        json(res, 200, {
          config: publicSiteConfigForAuth(config, auth),
          siteAccessToken: null,
          message: 'Token de sitio eliminado'
        })
        return
      }
      const token = generateSiteAccessToken()
      const config = saveSiteConfig(handle, { siteAccessToken: token })
      const mcp = getMcpConnectionInfo({ cmsUrl: CMS_PUBLIC_URL })
      const agentIcon = await prepareSiteAgentIcon(handle, siteCfg.domain || '', {
        soft: true,
        force: Boolean(body.refreshIcon)
      })
      json(res, 200, {
        config: publicSiteConfigForAuth(config, auth),
        siteAccessToken: token,
        message: 'Copia este token ahora. Solo se muestra una vez.',
        mcpUrl: mcp.mcpUrl,
        mcpChatGptUrl: mcp.chatgpt.url,
        mcpClaudeUrl: mcp.claude.url,
        mcpAuthHint: mcp.chatgpt.hint,
        mcpClaudeHint: mcp.claude.hint,
        mcpCursorHint: mcp.cursorHermes.hint,
        agentIcon
      })
      return
    }

    const agentIconMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)\/agent-icon$/)
    if (agentIconMatch && (req.method === 'GET' || req.method === 'POST')) {
      const handle = agentIconMatch[1]
      try {
        assertSiteAccess(auth, handle)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const siteCfg = loadSiteConfig(handle)
      if (!siteCfg) {
        json(res, 404, { message: 'Site no encontrado' })
        return
      }
      if (req.method === 'GET') {
        const mcp = getMcpConnectionInfo({ cmsUrl: CMS_PUBLIC_URL })
        json(res, 200, {
          agentIcon: readSiteAgentIcon(handle),
          mcpUrl: mcp.mcpUrl,
          mcpChatGptUrl: mcp.chatgpt.url,
          mcpClaudeUrl: mcp.claude.url,
          mcpAuthHint: mcp.chatgpt.hint,
          mcpClaudeHint: mcp.claude.hint
        })
        return
      }
      try {
        assertSuperAdmin(auth)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const body = await parseBody(req).catch(() => ({}))
      const agentIcon = await prepareSiteAgentIcon(handle, siteCfg.domain || '', {
        soft: true,
        force: body.force !== false
      })
      json(res, agentIcon.ok ? 200 : 502, { agentIcon })
      return
    }

    const siteConfigMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)$/)
    if (siteConfigMatch) {
      const handle = siteConfigMatch[1]
      try {
        assertSiteAccess(auth, handle)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      if (req.method === 'GET') {
        const config = loadSiteConfig(handle)
        if (!config) {
          json(res, 404, { message: 'Site no encontrado' })
          return
        }
        json(res, 200, { config: publicSiteConfigForAuth(config, auth) })
        return
      }
      if (req.method === 'POST') {
        try {
          assertAgencyOps(auth)
        } catch (err) {
          json(res, err.status || 403, { message: err.message })
          return
        }
        const body = await parseBody(req)
        const previous = loadSiteConfig(handle)
        const partial = {
          name: body.name,
          domain: body.domain,
          rebuildWebhookUrl: body.rebuildWebhookUrl,
          requiresHumanApproval: body.requiresHumanApproval
        }
        if (Object.prototype.hasOwnProperty.call(body, 'blogEnabled')) {
          partial.blogEnabled = body.blogEnabled
        }
        if (Object.prototype.hasOwnProperty.call(body, 'requiresPublishConfirmation')) {
          partial.requiresPublishConfirmation = body.requiresPublishConfirmation
        }
        if (Object.prototype.hasOwnProperty.call(body, 'reviewMode')) {
          partial.reviewMode = body.reviewMode
        }
        if (Object.prototype.hasOwnProperty.call(body, 'planId')) {
          partial.planId = body.planId
        }
        if (body.coolifyApiToken) partial.coolifyApiToken = body.coolifyApiToken
        if (body.clearCoolifyApiToken) partial.clearCoolifyApiToken = true
        if (body.socialPackChannels && typeof body.socialPackChannels === 'object') {
          partial.socialPackChannels = body.socialPackChannels
        }
        const config = saveSiteConfig(handle, partial)
        const blogToggled =
          previous && isPublicBlogEnabled(previous) !== isPublicBlogEnabled(config)
        let rebuild = null
        if (blogToggled) {
          rebuild = await notifyRebuild(handle)
        }
        json(res, 200, { config: publicSiteConfigForAuth(config, auth), rebuild })
        return
      }
    }

    const brandZipMatch = path.match(/^\/api\/admin\/brand-kit\/([^/]+)\/import-zip$/)
    if (brandZipMatch && req.method === 'POST') {
      const site = brandZipMatch[1]
      try {
        assertSiteAccess(auth, site)
        assertSuperAdmin(auth)
        const body = await parseBody(req)
        if (!body.contentBase64 && !body.zipUrl) {
          json(res, 400, { message: 'Falta zipUrl o contentBase64 del ZIP' })
          return
        }
        const result = await importBrandKitZip(site, {
          contentBase64: body.contentBase64,
          zipUrl: body.zipUrl
        })
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    const brandMatch = path.match(/^\/api\/admin\/brand-kit\/([^/]+)(?:\/([^/]+))?$/)
    if (brandMatch) {
      const site = brandMatch[1]
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const file = brandMatch[2] ? decodeURIComponent(brandMatch[2]) : ''
      const allowedFiles = brandFilesForAuth(auth)
      const allowedLabels = brandLabelsForAuth(auth)
      const allowed = !file || BRAND_ALL_FILES.includes(file) || file === 'agent-rules.md'
      if (req.method === 'GET' && !file) {
        json(res, 200, {
          ...getBrandContext(site, { auth }),
          files: allowedFiles,
          labels: allowedLabels
        })
        return
      }
      if (req.method === 'GET' && file && allowed) {
        try {
          assertBrandFileAccess(auth, file, { write: false })
          json(res, 200, { site, file, content: readBrandFile(site, file) })
        } catch (err) {
          json(res, err.status || 403, { message: err.message })
        }
        return
      }
      if (req.method === 'POST' && file && allowed) {
        try {
          assertBrandFileAccess(auth, file, { write: true })
          const body = await parseBody(req)
          writeBrandFile(site, file, body.content || '')
          json(res, 200, { ok: true, file })
        } catch (err) {
          json(res, err.status || 400, { message: err.message })
        }
        return
      }
    }

    if (req.method === 'POST' && path === '/api/admin/validate-seo') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
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
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        const result = await uploadMedia({ ...body, site })
        json(res, 200, result.media ? { media: result.media, ...result } : result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    if (req.method === 'DELETE' && path === '/api/admin/media') {
      const body = await parseBody(req).catch(() => ({}))
      const id = body.id || url.searchParams.get('id')
      const site = siteFrom(auth, body.site || url.searchParams.get('site') || DEFAULT_SITE)
      const mediaPath = body.path || url.searchParams.get('path') || ''
      try {
        assertSiteAccess(auth, site)
        const result = await cmsDeleteMedia(site, id, mediaPath)
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media/delete') {
      const body = await parseBody(req)
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        const result = await cmsDeleteMedia(site, body.id, body.path || '')
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const item = {
        id: body.id || `media-${Date.now()}`,
        site,
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
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
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
        reminder: getBrandContext(site, { auth }).reminder
      }, site, slug))
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts') {
      const body = await parseBody(req)
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        const result = await cmsUpdatePost({ ...body, site })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'GET' && path === '/api/admin/posts/calendar') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        const result = await cmsListCalendar(
          site,
          url.searchParams.get('from') || '',
          url.searchParams.get('to') || ''
        )
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/schedule') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        const result = await cmsSchedulePost(site, body.slug, body.publishAt)
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/confirm-schedule') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSuperAdmin(auth)
        assertSiteAccess(auth, site)
        const result = await cmsConfirmSchedule(site, body.slug)
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/cancel-schedule') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        const result = await cmsCancelSchedule(site, body.slug)
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/publish') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      const slug = body.slug
      try {
        assertSiteAccess(auth, site)
        // Con confirmación activa, client solo puede draft/changes_requested→review o programar.
        if (!body.publishAt && !isAgencyOrAdmin(auth)) {
          const siteConfig = loadSiteConfig(site)
          if (siteConfig?.requiresPublishConfirmation !== false) {
            const dbNow = readDb()
            const existing = findPost(dbNow, site, slug)
            const needsHuman = isAgencyGate(siteConfig)
            const submitForReviewOnly =
              needsHuman &&
              (existing?.status === 'draft' || existing?.status === 'changes_requested')
            if (existing && !submitForReviewOnly) {
              json(res, 403, {
                message:
                  'Solo agency o admin pueden publicar en vivo. Programa con publishAt o espera confirmación.'
              })
              return
            }
          }
        }
        const result = await cmsPublishPost(site, slug, { publishAt: body.publishAt })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/request-changes') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertAgencyOps(auth)
        const result = await cmsRequestPostChanges(site, body.slug, {
          rejectReason: body.rejectReason,
          actor: { role: auth.role }
        })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/unpublish') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        const result = await cmsUnpublishPost(site, body.slug)
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
        const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
        const slug = decodeURIComponent(del[1])
        try {
          assertSiteAccess(auth, site)
          const result = await cmsDeletePost(site, slug)
          json(res, 200, result)
        } catch (error) {
          const status = error.status || 500
          json(res, status, { message: error.message, ...(error.extra || {}) })
        }
        return
      }
    }
  }

  json(res, 404, { message: 'Ruta no encontrada' })
})

mkdirSync(dataDir, { recursive: true })
mkdirSync(mediaDir, { recursive: true })
if (!checkDataWritable()) {
  console.error(`[cms] No se puede escribir en ${dataDir}. Revisa Persistent Storage en Coolify.`)
} else {
  markPersistent()
}
seedAllBrandKits()

const dbBoot = readDb()
let dbRepaired = repairMediaInDb(dbBoot)
if (repairPostsInDb(dbBoot)) dbRepaired = true
if (dbRepaired) writeDb(dbBoot)

const persistence = getPersistenceStatus()
console.log(`[cms] dataDir=${persistence.dataDir} posts=${persistence.posts} media=${persistence.mediaFiles} volume=${persistence.likelyDockerVolume}`)
if (process.env.NODE_ENV === 'production' && !persistence.likelyDockerVolume) {
  console.warn('[cms] AVISO: sin volumen Docker detectado. Los posts pueden borrarse en el próximo deploy.')
}

server.listen(PORT, () => {
  console.log(`Escarlet blog CMS en http://localhost:${PORT}/admin`)
  console.log(`MCP remoto (Hermes) en http://localhost:${PORT}/mcp`)
})

const SCHEDULE_TICK_MS = Number(process.env.SCHEDULE_TICK_MS || 60_000)
const scheduleTimer = setInterval(() => {
  promoteDueScheduledPosts().catch((err) => {
    console.error('[schedule] promote falló', err.message)
  })
}, SCHEDULE_TICK_MS)
if (typeof scheduleTimer.unref === 'function') scheduleTimer.unref()

export { ADMIN_TOKEN, DEFAULT_SITE, CMS_PUBLIC_URL }
