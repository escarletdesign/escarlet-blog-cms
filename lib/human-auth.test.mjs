/**
 * F5 email/password auth. Google remains deferred.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-f5-auth-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.ADMIN_TOKEN = 'admin-secret-token'
process.env.PRODUCT_RESTRUCTURE_V1 = '1'
process.env.CMS_SKIP_SEED = '1'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({
    sites: [],
    authors: [],
    categories: [],
    media: [],
    posts: [],
    plans: [{ id: 'standard', name: 'Standard', draftLimit: 20, publishLimitPerMonth: 12 }],
    usage: {}
  })
)

after(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

const { createSite } = await import('./create-site.mjs')
const { generateSiteAccessToken, resolveAuth } = await import('./auth.mjs')
const { saveSiteConfig } = await import('./site-config.mjs')
const {
  registerPasswordUser,
  loginPasswordUser,
  listPasswordUsers,
  deletePasswordUser,
  googleAuthStatus,
  assertPasswordAuthEnabled
} = await import('./human-auth.mjs')

test('password login works and site token still works', async () => {
  await createSite({
    handle: 'auth-site',
    name: 'Auth',
    domain: 'https://auth.example',
    skipSeed: true
  })
  const siteTok = generateSiteAccessToken()
  saveSiteConfig('auth-site', { siteAccessToken: siteTok })

  registerPasswordUser({
    email: 'client@example.com',
    password: 'secretpass',
    site: 'auth-site',
    role: 'client'
  })

  const session = loginPasswordUser({ email: 'client@example.com', password: 'secretpass' })
  assert.ok(session.token.startsWith('sess_'))
  const auth = resolveAuth(session.token)
  assert.equal(auth.role, 'client')
  assert.equal(auth.site, 'auth-site')

  const siteAuth = resolveAuth(siteTok)
  assert.equal(siteAuth.role, 'client')
  assert.equal(siteAuth.site, 'auth-site')
})

test('list and delete password users by site', () => {
  const agency = registerPasswordUser({
    email: 'agency@example.com',
    password: 'secretpass',
    site: 'auth-site',
    role: 'agency_admin'
  })
  const listed = listPasswordUsers({ site: 'auth-site' })
  assert.ok(listed.some((u) => u.email === 'client@example.com'))
  assert.ok(listed.some((u) => u.id === agency.id && u.role === 'agency_admin'))
  assert.ok(listed.every((u) => !('hash' in u) && !('salt' in u)))

  deletePasswordUser({ id: agency.id })
  const after = listPasswordUsers({ site: 'auth-site' })
  assert.equal(after.some((u) => u.id === agency.id), false)
})

test('google auth is deferred', () => {
  const status = googleAuthStatus()
  assert.equal(status.available, false)
  assert.equal(status.deferred, true)
})

test('password auth unavailable when PRODUCT_RESTRUCTURE_V1 off', () => {
  const prev = process.env.PRODUCT_RESTRUCTURE_V1
  process.env.PRODUCT_RESTRUCTURE_V1 = ''
  assert.throws(() => assertPasswordAuthEnabled(), /unavailable/)
  process.env.PRODUCT_RESTRUCTURE_V1 = prev
})
