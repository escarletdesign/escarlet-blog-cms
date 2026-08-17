import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = __dirname
const dataDir = join(root, 'data')
const dbPath = join(dataDir, 'db.json')

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
const REBUILD_WEBHOOK_URL = process.env.REBUILD_WEBHOOK_URL || ''

function emptyDb() {
  return {
    sites: [{ id: 'escarlet', name: 'Escarlet', handle: 'escarlet', domain: 'https://escarlet.design' }],
    authors: [
      { id: 'charly', name: 'Charly', url: 'https://www.linkedin.com/in/carlos-brugiafredo/' },
      { id: 'silvia', name: 'Silvia', url: '' }
    ],
    categories: [],
    media: [],
    posts: []
  }
}

function readDb() {
  if (!existsSync(dbPath)) {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(dbPath, JSON.stringify(emptyDb(), null, 2))
  }
  return JSON.parse(readFileSync(dbPath, 'utf8'))
}

function writeDb(db) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(dbPath, JSON.stringify(db, null, 2))
}

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

function publicPost(post) {
  return {
    slug: post.slug,
    title: post.title,
    metaTitle: post.metaTitle || { es: post.title },
    metaDescription: post.metaDescription || { es: post.excerptEs || post.title },
    datePublished: post.datePublished,
    dateModified: post.dateModified || post.datePublished,
    imageUrl: post.imageUrl || '',
    imageAlt: post.imageAlt || post.title,
    imagePosition: post.imagePosition || '',
    substackUrl: post.substackUrl || '',
    authorName: post.authorName || 'Escarlet',
    excerptEs: post.excerptEs || '',
    bodyHtml: post.bodyHtml || '',
    relatedSlugs: post.relatedSlugs || [],
    status: post.status || 'draft'
  }
}

async function notifyRebuild() {
  const url = process.env.REBUILD_WEBHOOK_URL || REBUILD_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'escarlet-blog-cms' }) })
  } catch (error) {
    console.error('Rebuild webhook failed', error.message)
  }
}

function isAdmin(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const cookie = String(req.headers.cookie || '')
  const cookieToken = cookie.match(/(?:^|;\s*)escarlet_cms=([^;]+)/)?.[1]
  const expected = process.env.ADMIN_TOKEN || ADMIN_TOKEN
  return token === expected || cookieToken === expected
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

function serveAdmin(res) {
  const html = readFileSync(join(root, 'admin.html'), 'utf8')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    })
    res.end()
    return
  }

  if (req.method === 'GET' && (path === '/admin' || path === '/')) {
    serveAdmin(res)
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
    json(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && path === '/api/sites') {
    const db = readDb()
    json(res, 200, { sites: db.sites || [] })
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
    if (!isAdmin(req)) {
      json(res, 401, { message: 'No autorizado' })
      return
    }
    const db = readDb()
    if (req.method === 'GET' && path === '/api/admin/posts') {
      const site = url.searchParams.get('site') || DEFAULT_SITE
      json(res, 200, { posts: db.posts.filter((p) => p.site === site) })
      return
    }
    if (req.method === 'GET' && path === '/api/admin/sites') {
      json(res, 200, { sites: db.sites || [] })
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
      json(res, 200, { media: db.media || [] })
      return
    }
    if (req.method === 'POST' && path === '/api/admin/authors') {
      const body = await parseBody(req)
      const author = { id: body.id || body.name?.toLowerCase().replace(/\s+/g, '-') || `author-${Date.now()}`, ...body }
      db.authors = db.authors || []
      const idx = db.authors.findIndex((a) => a.id === author.id)
      if (idx >= 0) db.authors[idx] = { ...db.authors[idx], ...author }
      else db.authors.push(author)
      writeDb(db)
      json(res, 200, { author })
      return
    }
    if (req.method === 'POST' && path === '/api/admin/categories') {
      const body = await parseBody(req)
      const category = { id: body.slug || `cat-${Date.now()}`, ...body }
      db.categories = db.categories || []
      const idx = db.categories.findIndex((c) => c.slug === category.slug)
      if (idx >= 0) db.categories[idx] = { ...db.categories[idx], ...category }
      else db.categories.push(category)
      writeDb(db)
      json(res, 200, { category })
      return
    }
    if (req.method === 'POST' && path === '/api/admin/media') {
      const body = await parseBody(req)
      const item = { id: body.id || `media-${Date.now()}`, url: body.url || '', alt: body.alt || '' }
      db.media = db.media || []
      db.media.push(item)
      writeDb(db)
      json(res, 200, { media: item })
      return
    }
    if (req.method === 'POST' && path === '/api/admin/posts') {
      const body = await parseBody(req)
      const post = {
        id: body.slug || `post-${Date.now()}`,
        site: body.site || DEFAULT_SITE,
        status: body.status || 'draft',
        ...body
      }
      const idx = db.posts.findIndex((p) => p.site === post.site && p.slug === post.slug)
      if (idx >= 0) db.posts[idx] = { ...db.posts[idx], ...post }
      else db.posts.push(post)
      writeDb(db)
      if (post.status === 'published') await notifyRebuild()
      json(res, 200, { post })
      return
    }
    if (req.method === 'DELETE') {
      const del = path.match(/^\/api\/admin\/posts\/([^/]+)$/)
      if (del) {
        db.posts = db.posts.filter((p) => p.slug !== decodeURIComponent(del[1]))
        writeDb(db)
        json(res, 200, { ok: true })
        return
      }
    }
  }

  json(res, 404, { message: 'Ruta no encontrada' })
})

server.listen(PORT, () => {
  console.log(`Escarlet blog CMS en http://localhost:${PORT}/admin`)
})
