/** CMS Social Pack payload contract. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PACK_SOURCE_CMS,
  resolveSocialPackSource,
  isCmsSocialPackHostEnabled,
  normalizeSocialPack,
  hasSocialPackContent,
  buildSocialPackPayload,
  listSocialPackSummaries
} from './social-pack-host.mjs'
import { RUNTIME_FILES, getRuntimeManifest, getRuntimeFile } from './frontend-runtime.mjs'

test('Social Pack source is always the CMS', () => {
  assert.equal(resolveSocialPackSource({ cmsHostEnabled: true }), PACK_SOURCE_CMS)
  assert.equal(resolveSocialPackSource({ cmsHostEnabled: false }), null)
})

test('pack payload is served from CMS fields (not Vite artifacts)', () => {
  const post = {
    site: 'demo',
    slug: 'hello-pack',
    title: 'Hello pack',
    status: 'published',
    authorName: 'Ada',
    datePublished: '2026-09-01',
    imageUrl: 'https://cdn.example/cover.webp',
    imageAlt: 'Cover',
    socialPack: {
      substackTitle: 'Sub title',
      substackBody: 'Sub body\nhttps://demo.example/blog/hello-pack',
      linkedin: 'LinkedIn copy',
      x: 'Tweet copy',
      videoScript: '',
      instagramCaption: 'IG caption',
      instagramSlides: [{ imageUrl: 'https://cdn.example/s1.jpg', alt: 'Slide 1', headline: 'H1' }]
    }
  }
  const siteConfig = {
    domain: 'https://demo.example',
    socialPackChannels: {
      substack: true,
      linkedin: true,
      x: true,
      videoScript: false,
      instagramCarousel: true
    }
  }

  const payload = buildSocialPackPayload(post, siteConfig, { cmsHostEnabled: true })
  assert.ok(payload)
  assert.equal(payload.source, PACK_SOURCE_CMS)
  assert.equal(payload.slug, 'hello-pack')
  assert.equal(payload.articleUrl, 'https://demo.example/blog/hello-pack')
  assert.equal(payload.socialPack.substackTitle, 'Sub title')
  assert.equal(payload.channelsPresent.substack, true)
  assert.equal(payload.channelsPresent.instagramCarousel, true)
  assert.equal(payload.channelsPresent.videoScript, false)

  const list = listSocialPackSummaries([post], siteConfig, { cmsHostEnabled: true })
  assert.equal(list.length, 1)
  assert.equal(list[0].source, PACK_SOURCE_CMS)
  assert.equal(list[0].slug, 'hello-pack')
})

test('normalizeSocialPack and hasSocialPackContent respect channels', () => {
  const pack = normalizeSocialPack(
    { linkedin: ' Hi ', instagramSlides: [{ imageUrl: '/a.jpg', alt: '' }] },
    'T'
  )
  assert.equal(pack.linkedin, 'Hi')
  assert.equal(pack.substackTitle, 'T')
  assert.equal(pack.instagramSlides.length, 1)

  assert.equal(
    hasSocialPackContent({ socialPack: { linkedin: 'x' } }, { linkedin: true }),
    true
  )
  assert.equal(
    hasSocialPackContent({ socialPack: { linkedin: 'x' } }, { linkedin: false, x: true }),
    false
  )
})

test('video scripts remain part of the CMS payload', () => {
  const post = {
    site: 'demo',
    slug: 'reel-pack',
    title: 'Reel pack',
    status: 'published',
    socialPack: {
      videoScript: 'Hola.\n\nHoy te cuento una idea en un minuto.'
    }
  }
  const siteConfig = {
    domain: 'https://demo.example',
    socialPackChannels: {
      substack: false,
      linkedin: false,
      x: false,
      videoScript: true,
      instagramCarousel: false
    }
  }
  const payload = buildSocialPackPayload(post, siteConfig, { cmsHostEnabled: true })
  assert.equal(payload.channelsPresent.videoScript, true)
  assert.equal(payload.socialPack.videoScript, 'Hola.\n\nHoy te cuento una idea en un minuto.')
})

test('RUNTIME_FILES only serves the sync hook', () => {
  assert.deepEqual(RUNTIME_FILES, ['sync-blog-cms.mjs'])
  const manifest = getRuntimeManifest()
  assert.deepEqual(
    manifest.files.map((f) => f.name),
    ['sync-blog-cms.mjs']
  )
  assert.equal(getRuntimeFile('generate-blog-social-packs.mjs'), null)
  assert.ok(manifest.note.includes('Social Pack') || manifest.note.includes('CMS'))
})

test('isCmsSocialPackHostEnabled follows PRODUCT_RESTRUCTURE_V1', () => {
  const prev = process.env.PRODUCT_RESTRUCTURE_V1
  try {
    process.env.PRODUCT_RESTRUCTURE_V1 = '1'
    assert.equal(isCmsSocialPackHostEnabled(), true)
    process.env.PRODUCT_RESTRUCTURE_V1 = ''
    assert.equal(isCmsSocialPackHostEnabled(), false)
  } finally {
    if (prev === undefined) delete process.env.PRODUCT_RESTRUCTURE_V1
    else process.env.PRODUCT_RESTRUCTURE_V1 = prev
  }
})
