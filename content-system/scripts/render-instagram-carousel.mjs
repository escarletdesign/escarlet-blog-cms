#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { renderSlidePng } from '../../lib/instagram-renderer.mjs'

function args(argv) {
  return Object.fromEntries(argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, '').split('=')
    return [key, rest.join('=') || true]
  }))
}

const input = args(process.argv)
if (!input.input) throw new Error('Usa --input=content-system/examples/sample-carousel-output.json')
const payload = JSON.parse(readFileSync(String(input.input), 'utf8'))
const outputDir = String(input.output || 'tmp/carousel')
mkdirSync(outputDir, { recursive: true })
const templateId = String(input.template || payload.visualSystem?.templateId || 'editorial')
const backgrounds = Array.isArray(payload.backgrounds) ? payload.backgrounds : []
const files = []
for (let index = 0; index < Math.min(payload.instagramSlides?.length || 0, 7); index += 1) {
  const slide = payload.instagramSlides[index]
  const png = renderSlidePng({
    site: String(input.site || payload.site || 'escarlet'),
    templateId,
    slide,
    backgroundBase64: backgrounds[index]?.base64 || backgrounds[index] || ''
  })
  const filename = `${String(slide.id || `slide-${index + 1}`).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.png`
  const path = join(outputDir, filename)
  writeFileSync(path, png)
  files.push(path)
}
console.log(JSON.stringify({ outputDir, templateId, files }, null, 2))
