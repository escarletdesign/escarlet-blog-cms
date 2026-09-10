#!/usr/bin/env node
/** Install the portable blog + SEO integration in any Node-based landing. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFrontendTemplates } from '../lib/create-site.mjs'

const argv = process.argv.slice(2)
const targetArg = argv.indexOf('--target')
const target = resolve(targetArg >= 0 ? argv[targetArg + 1] || '.' : '.')
const scriptsDir = join(target, 'scripts')
mkdirSync(scriptsDir, { recursive: true })
const copied = copyFrontendTemplates(scriptsDir)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const seoSource = join(root, 'integrations', 'seo', 'index.mjs')
copyFileSync(seoSource, join(scriptsDir, 'escarlet-seo.mjs'))
const example = join(root, 'integrations', 'seo', 'site-manifest.example.json')
const manifestTarget = join(target, 'seo-manifest.json')
if (!existsSync(manifestTarget)) writeFileSync(manifestTarget, readFileSync(example))
console.log(`✓ Integración instalada en ${target}`)
console.log(`  ${copied.length + 1} scripts copiados; manifiesto SEO: ${manifestTarget}`)
