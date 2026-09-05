import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmbedSession,
  consumeEmbedSession,
  sanitizeNext,
  frameAncestorsHeader
} from './embed-session.mjs'

test('sanitizeNext only allows hash routes', () => {
  assert.equal(sanitizeNext(''), '#/entradas')
  assert.equal(sanitizeNext('#/entrada/hola'), '#/entrada/hola')
  assert.equal(sanitizeNext('entrada/hola/revisar'), '#/entrada/hola/revisar')
  assert.equal(sanitizeNext('https://evil.example'), '#/entradas')
  assert.equal(sanitizeNext('//evil'), '#/entradas')
})

test('create and consume embed session once', () => {
  const created = createEmbedSession({
    token: 'site_test_token_abc',
    site: 'demo',
    next: '#/entrada/post-uno'
  })
  assert.ok(created.code)
  assert.ok(created.expiresAt > Date.now())

  const first = consumeEmbedSession(created.code)
  assert.equal(first.token, 'site_test_token_abc')
  assert.equal(first.site, 'demo')
  assert.equal(first.next, '#/entrada/post-uno')

  const second = consumeEmbedSession(created.code)
  assert.equal(second, null)
})

test('frameAncestorsHeader builds allowlist', () => {
  assert.equal(frameAncestorsHeader([]), "frame-ancestors 'self'")
  assert.match(
    frameAncestorsHeader('https://cliente.example/'),
    /frame-ancestors 'self' https:\/\/cliente\.example/
  )
})
