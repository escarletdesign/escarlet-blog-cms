import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_CMS_URL,
  DEPRECATED_CMS_HOSTS,
  canonicalCmsPublicUrl,
  normalizeCmsPublicUrl
} from './cms-url.mjs'

test('el host retirado nunca se anuncia como MCP público', () => {
  assert.deepEqual(DEPRECATED_CMS_HOSTS, ['blog-cms.escarlet.cc'])
  assert.equal(normalizeCmsPublicUrl('https://blog-cms.escarlet.cc'), CANONICAL_CMS_URL)
  assert.equal(canonicalCmsPublicUrl('https://blog-cms.escarlet.cc'), CANONICAL_CMS_URL)
})

test('las URLs locales siguen funcionando para desarrollo', () => {
  assert.equal(canonicalCmsPublicUrl('http://localhost:3040'), 'http://localhost:3040')
  assert.equal(canonicalCmsPublicUrl('http://127.0.0.1:3040/'), 'http://127.0.0.1:3040')
})

test('el fallback vacío es siempre el dominio v2', () => {
  assert.equal(normalizeCmsPublicUrl(''), CANONICAL_CMS_URL)
})
