import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalVariantState, missingVariantFields, nextVariantBody, summarizeContentListItem, validationDiagnostic } from './content-variant-state.mjs'

function slide(index) {
  return { headline: `H${index}`, body: `B${index}`, alt: `A${index}` }
}

function media(index, expected, { channel = 'instagram', itemId = 'item-1', preparationId = 'prep-1', assetType = 'social_image', width = 1080, height = 1350 } = {}) {
  return {
    id: `asset-${index}`,
    assetIndex: index,
    width,
    height,
    metadata: {
      width,
      height,
      brandGrounding: {
        assetIndex: index,
        expectedAssetCount: expected,
        brandPreparationId: preparationId,
        itemId,
        channels: [channel],
        assetType,
        generatedWidth: width,
        generatedHeight: height
      }
    }
  }
}

function instagramVariant({ slides, assets, expected = slides.length, itemId = 'item-1' }) {
  return {
    id: 'variant-ig',
    itemId,
    channel: 'instagram',
    body: {
      slides: slides.map((_, index) => ({ id: index })),
      socialPack: { instagramCaption: 'Pie de foto', instagramSlides: slides }
    },
    media: assets
  }
}

test('un carrusel de 8 slides completos pasa a revisión', () => {
  const slides = Array.from({ length: 8 }, (_, index) => slide(index))
  const variant = instagramVariant({
    slides,
    assets: slides.map((_, index) => media(index, 8))
  })
  const state = canonicalVariantState(variant)
  assert.equal(state.expectedAssetCount, 8)
  assert.equal(state.instagramSlides.length, 8)
  assert.deepEqual(state.assetIndexes, [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(missingVariantFields(variant), [])
})

test('un carrusel con 8 assets y 4 slides nombra los índices que faltan', () => {
  const variant = instagramVariant({
    slides: Array.from({ length: 4 }, (_, index) => slide(index)),
    assets: Array.from({ length: 8 }, (_, index) => media(index, 8)),
    expected: 8
  })
  variant.body.slides = Array.from({ length: 8 }, (_, index) => ({ id: index }))
  const fields = missingVariantFields(variant)
  assert.deepEqual(fields.filter((field) => field.startsWith('socialPack.instagramSlides')), [
    'socialPack.instagramSlides[4]',
    'socialPack.instagramSlides[5]',
    'socialPack.instagramSlides[6]',
    'socialPack.instagramSlides[7]'
  ])
  const diagnostic = validationDiagnostic('item-1', variant, fields)
  assert.equal(diagnostic.event, 'content_validation_failed')
  assert.equal(diagnostic.expectedAssetCount, 8)
  assert.equal(diagnostic.mediaCount, 8)
  assert.equal(diagnostic.instagramSlidesCount, 4)
  assert.equal(diagnostic.bodySlidesCount, 8)
})

test('índices de media duplicados o con huecos no cuentan como carrusel completo', () => {
  const slides = Array.from({ length: 8 }, (_, index) => slide(index))
  const indexes = [0, 1, 2, 3, 3, 4, 5, 6]
  const variant = instagramVariant({
    slides,
    assets: indexes.map((index, position) => ({ ...media(index, 8), id: `asset-${position}` }))
  })
  const fields = missingVariantFields(variant)
  assert.ok(fields.includes('media.assetIndex[3] duplicate'))
  assert.ok(fields.includes('media.assetIndex[7]'))
})

test('una imagen suelta de Instagram no exige carrusel', () => {
  const variant = {
    id: 'variant-ig',
    itemId: 'item-1',
    channel: 'instagram',
    body: { socialPack: { instagramCaption: 'Una sola imagen' } },
    media: [media(0, 1)]
  }
  assert.equal(canonicalVariantState(variant).expectedAssetCount, 1)
  assert.deepEqual(missingVariantFields(variant), [])
})

test('una story de 5 frames valida cada frame y su imagen', () => {
  const frames = Array.from({ length: 5 }, (_, index) => ({ alt: `F${index}` }))
  const variant = {
    id: 'variant-story',
    itemId: 'item-1',
    channel: 'instagram_story',
    body: { socialPack: { instagramStory: { text: 'Historia', linkUrl: 'https://escarlet.design/post', frames } } },
    media: frames.map((_, index) => media(index, 5, { channel: 'instagram_story', assetType: 'instagram_story', width: 1080, height: 1920 }))
  }
  assert.equal(canonicalVariantState(variant).expectedAssetCount, 5)
  assert.deepEqual(missingVariantFields(variant), [])
})

test('LinkedIn no hereda la validación del carrusel de Instagram', () => {
  const variant = {
    id: 'variant-li',
    itemId: 'item-1',
    channel: 'linkedin',
    body: {
      text: 'Texto de LinkedIn',
      socialPack: { instagramSlides: [slide(0)] }
    },
    media: [media(0, 1, { channel: 'linkedin', assetType: 'blog_cover', width: 1536, height: 1024 })]
  }
  assert.deepEqual(missingVariantFields(variant), [])
})

test('el blog valida la portada y no el carrusel', () => {
  const variant = {
    id: 'variant-blog',
    itemId: 'item-1',
    channel: 'blog',
    body: {
      title: 'Título',
      slug: 'titulo',
      excerpt: 'Resumen',
      bodyHtml: '<p>Cuerpo</p>',
      metaTitle: 'Meta',
      metaDescription: 'Descripción',
      imageAlt: 'Alt',
      author: 'Escarlet'
    },
    media: [media(0, 1, { channel: 'blog', assetType: 'blog_cover', width: 1536, height: 1024 })]
  }
  assert.deepEqual(missingVariantFields(variant), [])
})

test('el body recibido reemplaza el JSON anterior, incluidos los slides', () => {
  const previous = { socialPack: { instagramSlides: [slide(0), slide(1), slide(2), slide(3)] } }
  const next = { socialPack: { instagramCaption: 'Nuevo', instagramSlides: Array.from({ length: 8 }, (_, index) => slide(index)) } }
  const stored = nextVariantBody({ currentBody: previous, body: next })
  assert.equal(stored.socialPack.instagramSlides.length, 8)
  assert.equal(stored.socialPack.instagramSlides[7].headline, 'H7')
  assert.equal(stored.socialPack.instagramCaption, 'Nuevo')
  const briefOnly = nextVariantBody({ currentBody: next, visualBrief: { palette: 'cian' } })
  assert.equal(briefOnly.socialPack.instagramSlides.length, 8)
  assert.equal(briefOnly.visualBrief.palette, 'cian')
})

test('el listado resume el item sin arrastrar el body', () => {
  const summary = summarizeContentListItem({
    id: 'item-1',
    batch_id: 'batch-1',
    topic: 'x'.repeat(200),
    status: 'draft',
    metadata: { contentTitle: 'La tipografía' },
    created_at: '2026-10-06T18:15:49.855Z',
    updated_at: '2026-10-06T18:16:00.000Z',
    variants: [
      { channel: 'instagram', status: 'draft', mediaCount: 8, body: { socialPack: { secret: true } } },
      { channel: 'blog', status: 'generated', mediaCount: 1 }
    ]
  })
  assert.equal(summary.batchId, 'batch-1')
  assert.equal(summary.title, 'La tipografía')
  assert.equal(summary.topic.endsWith('…'), true)
  assert.equal(summary.topic.length <= 180, true)
  assert.deepEqual(summary.channels, ['instagram', 'blog'])
  assert.deepEqual(summary.variantStatus, { instagram: 'draft', blog: 'generated' })
  assert.equal(summary.mediaCount, 9)
  assert.equal(summary.body, undefined)
  assert.equal(summary.createdAt, '2026-10-06T18:15:49.855Z')
})
