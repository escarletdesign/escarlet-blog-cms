import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAuth, resolveRequestAuth, resolveRequestAuthAsync } from './auth.mjs'

const localUrl = new URL('http://localhost/api/admin/session')
const localReq = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers: { host: 'localhost:3040', ...headers } })

test('missing ADMIN_TOKEN fails closed and never accepts the historical placeholder', () => {
  const previous = process.env.ADMIN_TOKEN
  delete process.env.ADMIN_TOKEN
  try {
    assert.equal(resolveAuth('cambia-esto'), null)
    assert.equal(resolveAuth(''), null)
    process.env.ADMIN_TOKEN = 'configured-admin-token'
    assert.equal(resolveAuth('configured-admin-token')?.role, 'admin')
  } finally {
    if (previous === undefined) delete process.env.ADMIN_TOKEN
    else process.env.ADMIN_TOKEN = previous
  }
})

test('loopback without cookie is admin outside production', () => {
  const prevNode = process.env.NODE_ENV
  const prevFlag = process.env.LOCAL_AUTO_LOGIN
  delete process.env.NODE_ENV
  delete process.env.LOCAL_AUTO_LOGIN
  try {
    const auth = resolveRequestAuth(localReq('127.0.0.1'), localUrl)
    assert.equal(auth?.role, 'admin')
    assert.equal(auth?.systemAdmin, true)
    assert.equal(resolveRequestAuth(localReq('::1'), localUrl)?.role, 'admin')
    assert.equal(resolveRequestAuth(localReq('::ffff:127.0.0.1'), localUrl)?.role, 'admin')
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
    if (prevFlag === undefined) delete process.env.LOCAL_AUTO_LOGIN
    else process.env.LOCAL_AUTO_LOGIN = prevFlag
  }
})

test('production and remote clients never auto-login', () => {
  const prevNode = process.env.NODE_ENV
  const prevFlag = process.env.LOCAL_AUTO_LOGIN
  try {
    process.env.NODE_ENV = 'production'
    delete process.env.LOCAL_AUTO_LOGIN
    assert.equal(resolveRequestAuth(localReq('127.0.0.1'), localUrl), null)
    delete process.env.NODE_ENV
    assert.equal(resolveRequestAuth(localReq('8.8.8.8'), localUrl), null)
    assert.equal(resolveRequestAuth(localReq('8.8.8.8', { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'localhost' }), localUrl), null)
    process.env.LOCAL_AUTO_LOGIN = '0'
    assert.equal(resolveRequestAuth(localReq('127.0.0.1'), localUrl), null)
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
    if (prevFlag === undefined) delete process.env.LOCAL_AUTO_LOGIN
    else process.env.LOCAL_AUTO_LOGIN = prevFlag
  }
})

test('un JWT con Auth0 configurado no puede degradar a PAT local', async () => {
  const previous = {}
  for (const name of ['ADMIN_TOKEN', 'AUTH0_ENABLED', 'AUTH0_ISSUER', 'AUTH0_AUDIENCE', 'AUTH0_JWKS_URL', 'DATABASE_URL']) previous[name] = process.env[name]
  const token = 'header.payload.signature'
  process.env.ADMIN_TOKEN = token
  process.env.AUTH0_ENABLED = '1'
  process.env.AUTH0_ISSUER = 'https://tenant.example.auth0.com'
  process.env.AUTH0_AUDIENCE = 'https://cms.escarlet.design/mcp/v3'
  process.env.AUTH0_JWKS_URL = 'https://tenant.example.auth0.com/.well-known/jwks.json'
  delete process.env.DATABASE_URL
  try {
    const auth = await resolveRequestAuthAsync(localReq('8.8.8.8', { authorization: `Bearer ${token}` }), localUrl)
    assert.equal(auth, null)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
