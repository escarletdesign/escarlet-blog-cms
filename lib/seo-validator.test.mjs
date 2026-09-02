import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePostSeo } from './seo-validator.mjs'

const basePost = {
  site: 'escarlet',
  slug: 'test-post-seo',
  title: 'Cómo elegir diseñador web en Almería',
  metaTitle: { es: 'Cómo elegir diseñador web en Almería | Escarlet' },
  metaDescription: {
    es: 'Guía práctica para elegir diseñador web en Almería. Qué mirar, qué preguntar y cómo decidir con criterio antes de invertir.'
  },
  authorName: 'Silvia',
  imageUrl: '/images/blog/test-post-seo.webp',
  imageAlt: 'Persona revisando propuestas de diseño web en un portátil en una oficina luminosa',
  excerptEs: 'Elegir diseñador web en Almería sin perder meses es posible si ordenas criterios antes de firmar.',
  relatedSlugs: [],
  bodyHtml: '<p>'.concat('Palabra '.repeat(450), '</p><a href="/blog/otro">Otro</a>'),
  socialPack: {
    substackTitle: 'Cómo elegir diseñador web',
    substackBody: 'Resumen del artículo.\n\nhttps://escarlet.design/blog/test-post-seo',
    linkedin: 'Post LinkedIn.\n\nhttps://escarlet.design/blog/test-post-seo',
    x: 'Gancho.\n\nhttps://escarlet.design/blog/test-post-seo'
  }
}

test('validatePostSeo acepta post completo con reglas suaves', () => {
  const result = validatePostSeo(basePost)
  assert.equal(result.ok, true)
  assert.equal(result.errors.length, 0)
})

test('validatePostSeo rechaza pocas palabras', () => {
  const result = validatePostSeo({ ...basePost, bodyHtml: '<p>Corto.</p>' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('palabras')))
})

test('validatePostSeo avisa dos puntos pero no bloquea', () => {
  const result = validatePostSeo({ ...basePost, title: 'Título: malo' })
  assert.equal(result.ok, true)
  assert.ok(result.warnings.some((e) => e.includes('dos puntos')))
})

test('validatePostSeo cuenta enlaces internos en markdown', () => {
  const body = `${'Palabra '.repeat(450)}\n\n[Servicios](/servicios)`
  const result = validatePostSeo({ ...basePost, bodyHtml: body })
  assert.equal(result.internalLinks, 1)
})
