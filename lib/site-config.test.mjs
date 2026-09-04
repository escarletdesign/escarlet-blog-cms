import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadSiteConfig,
  saveSiteConfig,
  getRebuildWebhookUrl,
  getCoolifyApiToken,
  publicSiteConfig,
  getSocialPackChannels,
  normalizeSocialPackChannels,
  normalizeCoolifyDeployUrl,
  withCoolifyForceRebuild
} from './site-config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('saveSiteConfig persiste webhook y token en data/site-config', () => {
  const handle = 'site-config-test'
  saveSiteConfig(handle, {
    domain: 'https://example.test',
    rebuildWebhookUrl: 'https://coolify.test/deploy?uuid=abc',
    coolifyApiToken: 'token-secreto-1234'
  })
  const config = loadSiteConfig(handle)
  assert.equal(config.domain, 'https://example.test')
  assert.equal(getRebuildWebhookUrl(config), 'https://coolify.test/deploy?uuid=abc')
  assert.equal(getCoolifyApiToken(config), 'token-secreto-1234')
  const pub = publicSiteConfig(config)
  assert.equal(pub.hasCoolifyApiToken, true)
  assert.equal(pub.coolifyApiToken, undefined)
  assert.equal(pub.coolifyApiTokenHint, '…1234')
  rmSync(join(root, 'data', 'site-config', `${handle}.json`), { force: true })
})

test('socialPackChannels se normaliza y persiste por sitio', () => {
  const handle = 'site-channels-test'
  saveSiteConfig(handle, {
    domain: 'https://channels.test',
    socialPackChannels: {
      substack: false,
      linkedin: true,
      x: true,
      videoScript: false,
      instagramCarousel: true
    }
  })
  const config = loadSiteConfig(handle)
  const channels = getSocialPackChannels(config)
  assert.equal(channels.substack, false)
  assert.equal(channels.instagramCarousel, true)
  assert.equal(channels.videoScript, false)
  assert.deepEqual(normalizeSocialPackChannels({ substack: 0 }), {
    substack: false,
    linkedin: true,
    x: true,
    videoScript: true,
    instagramCarousel: true
  })
  rmSync(join(root, 'data', 'site-config', `${handle}.json`), { force: true })
})

test('blogEnabled se persiste y por defecto el blog está encendido', () => {
  const handle = 'site-blog-switch-test'
  saveSiteConfig(handle, { domain: 'https://blog-switch.test' })
  assert.equal(loadSiteConfig(handle).blogEnabled, true)
  saveSiteConfig(handle, { blogEnabled: false })
  assert.equal(loadSiteConfig(handle).blogEnabled, false)
  saveSiteConfig(handle, { blogEnabled: true })
  assert.equal(loadSiteConfig(handle).blogEnabled, true)
  assert.equal(publicSiteConfig(loadSiteConfig(handle)).blogEnabled, true)
  rmSync(join(root, 'data', 'site-config', `${handle}.json`), { force: true })
})

test('normalizeCoolifyDeployUrl quita force=false que en Coolify 4.1 dispara --no-cache', () => {
  assert.equal(
    normalizeCoolifyDeployUrl('https://coolify.escarlet.cc/api/v1/deploy?uuid=abc&force=false'),
    'https://coolify.escarlet.cc/api/v1/deploy?uuid=abc'
  )
  assert.equal(
    normalizeCoolifyDeployUrl('https://coolify.escarlet.cc/api/v1/deploy?force=0&uuid=abc'),
    'https://coolify.escarlet.cc/api/v1/deploy?uuid=abc'
  )
  assert.equal(
    normalizeCoolifyDeployUrl('https://coolify.escarlet.cc/api/v1/deploy?uuid=abc&force=true'),
    'https://coolify.escarlet.cc/api/v1/deploy?uuid=abc&force=true'
  )
  assert.equal(
    getRebuildWebhookUrl({ rebuildWebhookUrl: 'https://coolify.test/deploy?uuid=1&force=false' }),
    'https://coolify.test/deploy?uuid=1'
  )
  assert.equal(
    withCoolifyForceRebuild('https://coolify.escarlet.cc/api/v1/deploy?uuid=abc&force=false'),
    'https://coolify.escarlet.cc/api/v1/deploy?uuid=abc&force=true'
  )
  assert.equal(
    withCoolifyForceRebuild('https://coolify.escarlet.cc/api/v1/deploy?uuid=abc'),
    'https://coolify.escarlet.cc/api/v1/deploy?uuid=abc&force=true'
  )
})
