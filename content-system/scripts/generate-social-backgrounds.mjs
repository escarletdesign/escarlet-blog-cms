#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { chooseSocialTemplate } from '../../lib/visual-system.mjs'

function args(argv) {
  return Object.fromEntries(argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, '').split('=')
    return [key, rest.join('=') || true]
  }))
}

const input = args(process.argv)
const source = input.input ? JSON.parse(readFileSync(String(input.input), 'utf8')) : { instagramSlides: [] }
const site = String(input.site || source.site || 'escarlet')
const template = chooseSocialTemplate({ site, preferredId: String(input.template || source.visualSystem?.templateId || '') })
const slides = (source.instagramSlides || []).map((slide, index, all) => ({
  index: index + 1,
  templateId: template?.id || 'editorial',
  backgroundStyle: index === 0 || index === all.length - 1 ? 'brand-color' : 'light-or-grayscale',
  prompt: `Fondo abstracto editorial para un carrusel de Instagram sobre ${slide.headline || source.title || 'una idea de diseño'}. No texto ni letras. Deja espacio limpio para una capa tipográfica posterior. Tratamiento ${index === 0 || index === all.length - 1 ? 'bosque, cian, oro y signal' : 'blanco, gris o escala de grises, nunca papel crema'}.`
}))
console.log(JSON.stringify({ site, templateId: template?.id || 'editorial', slides }, null, 2))
