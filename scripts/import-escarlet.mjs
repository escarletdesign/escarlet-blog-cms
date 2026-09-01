import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const cmsRoot = join(root, '..')
const exportPath =
  process.env.ESCARLET_BLOG_EXPORT ||
  join(cmsRoot, '../escarlet002/content/blog-export.json')
const dbPath = join(cmsRoot, 'data/db.json')

if (!existsSync(exportPath)) {
  console.error('No encuentro', exportPath)
  console.error('Ejecuta npm run blog:export en escarlet002')
  process.exit(1)
}

const exported = JSON.parse(readFileSync(exportPath, 'utf8'))
const posts = (exported.posts || []).map((post) => ({
  ...post,
  site: exported.site || 'escarlet',
  status: post.status || 'published',
  relatedSlugs: post.relatedSlugs || post.relatedPostSlugs || [],
  socialPack: post.socialPack || null
}))

mkdirSync(join(cmsRoot, 'data'), { recursive: true })
const db = existsSync(dbPath)
  ? JSON.parse(readFileSync(dbPath, 'utf8'))
  : { sites: [], authors: [], categories: [], media: [], posts: [] }

db.posts = [...db.posts.filter((p) => p.site !== 'escarlet'), ...posts]
db.categories = db.categories || []
db.media = db.media || []
if (!db.sites?.some((s) => s.handle === 'escarlet')) {
  db.sites = db.sites || []
  db.sites.push({ id: 'escarlet', name: 'Escarlet', handle: 'escarlet', domain: 'https://escarlet.design' })
}
writeFileSync(dbPath, JSON.stringify(db, null, 2))
console.log('Importados', posts.length, 'posts de Escarlet')
