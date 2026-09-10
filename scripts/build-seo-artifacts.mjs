#!/usr/bin/env node
/**
 * Build-time adapter for static/Vite/Vue landings.
 * Usage: node scripts/build-seo-artifacts.mjs --manifest path/to/seo-manifest.json --out public
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildAgentNavigation, buildRobotsTxt, buildSitemapXml } from '../integrations/seo/index.mjs'

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback
}

const manifestPath = resolve(arg('--manifest', process.env.SEO_MANIFEST || 'seo-manifest.json'))
const outputDir = resolve(arg('--out', process.env.SEO_OUT || 'public'))
if (!existsSync(manifestPath)) throw new Error(`No existe el manifiesto SEO: ${manifestPath}`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const pages = Array.isArray(manifest.pages) ? manifest.pages : []
if (!manifest.site || !pages.length) throw new Error('El manifiesto SEO requiere site y pages[]')

mkdirSync(outputDir, { recursive: true })
const sitemapEntries = pages.filter((page) => page.sitemap !== false && !page.noindex).map((page) => ({
  url: page.canonical,
  lastmod: page.lastmod,
  changefreq: page.changefreq || 'monthly',
  priority: page.priority ?? '0.7'
}))
writeFileSync(resolve(outputDir, 'sitemap.xml'), buildSitemapXml(sitemapEntries))
writeFileSync(resolve(outputDir, 'robots.txt'), buildRobotsTxt({ sitemapUrl: `${manifest.site.replace(/\/$/, '')}/sitemap.xml`, disallow: manifest.disallow || [] }))
writeFileSync(resolve(outputDir, 'agent-navigation.json'), `${JSON.stringify(buildAgentNavigation(manifest), null, 2)}\n`)
console.log(`[seo] ${sitemapEntries.length} URLs → ${outputDir}`)
