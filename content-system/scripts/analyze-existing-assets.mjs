#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { statSync } from 'node:fs'
import { mediaDir, readDb } from '../../lib/db.mjs'
import { recentVisualHistory } from '../../lib/visual-system.mjs'

function args(argv) {
  return Object.fromEntries(argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, '').split('=')
    return [key, rest.join('=') || true]
  }))
}

const input = args(process.argv)
const db = input.db ? JSON.parse(readFileSync(String(input.db), 'utf8')) : readDb()
const site = String(input.site || 'escarlet')
const posts = (db.posts || []).filter((post) => post.site === site)
const byFilename = new Map()
const byHash = new Map()
const assets = posts.map((post) => {
  const filename = basename(String(post.imageUrl || '').split('?')[0])
  const localCandidates = filename ? [join(mediaDir, site, filename), join(process.cwd(), 'public', 'images', 'blog', filename)] : []
  const localPath = localCandidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) || ''
  const hash = localPath ? createHash('sha1').update(readFileSync(localPath)).digest('hex') : ''
  if (filename) byFilename.set(filename, [...(byFilename.get(filename) || []), post.slug])
  if (hash) byHash.set(hash, [...(byHash.get(hash) || []), post.slug])
  const repeated = (filename && (byFilename.get(filename)?.length > 1)) || (hash && (byHash.get(hash)?.length > 1))
  const hasMetadata = Boolean(post.visualBrief?.archetype || post.imageMetadata?.archetype)
  return {
    slug: post.slug,
    title: post.title,
    status: post.status,
    filename,
    localPath,
    sha1: hash,
    archetype: post.visualBrief?.archetype || post.imageMetadata?.archetype || '',
    action: repeated ? 'regenerate' : hasMetadata ? 'conservar' : 'revisar',
    reasons: [
      repeated ? 'filename o contenido repetido' : '',
      !hasMetadata ? 'falta metadata visual' : ''
    ].filter(Boolean)
  }
})
const duplicateFilenames = [...byFilename.entries()].filter(([, slugs]) => slugs.length > 1).map(([filename, slugs]) => ({ filename, slugs }))
const duplicateHashes = [...byHash.entries()].filter(([, slugs]) => slugs.length > 1).map(([sha1, slugs]) => ({ sha1, slugs }))
for (const duplicate of duplicateFilenames) {
  const stem = duplicate.filename.replace(/\.[^.]+$/, '')
  const canonical = duplicate.slugs.find((slug) => slug === stem) || duplicate.slugs[0]
  for (const asset of assets) {
    if (!duplicate.slugs.includes(asset.slug) || asset.slug === canonical) continue
    asset.action = 'regenerate'
    if (!asset.reasons.includes('filename o contenido repetido')) asset.reasons.push('filename o contenido repetido')
  }
}
const report = {
  site,
  generatedAt: new Date().toISOString(),
  inspectedPosts: posts.length,
  recentHistory: recentVisualHistory(site, { db }),
  duplicateFilenames,
  duplicateHashes,
  summary: {
    regenerate: assets.filter((asset) => asset.action === 'regenerate').length,
    review: assets.filter((asset) => asset.action === 'revisar').length,
    keep: assets.filter((asset) => asset.action === 'conservar').length
  },
  assets
}
if (input.json) writeFileSync(String(input.json), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
