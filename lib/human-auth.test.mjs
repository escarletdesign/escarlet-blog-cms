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
const { resolveAuth, publicAuthSession } = await import('./auth.mjs')
const {
  registerPasswordUser,
  loginPasswordUser,
  listPasswordUsers,
  deletePasswordUser,
  googleAuthStatus,
  assertPasswordAuthEnabled,
  mintUserLoginToken,
  revokeUserLoginToken,
  setUserPassword,
  updatePasswordUser,
  updateUserProfile,
  listSiteAuthors,
  mintAuthorInvite,
  consumeAuthorInvite
} = await import('./human-auth.mjs')

test('password login works and site tokens are rejected', async () => {
  await createSite({
    handle: 'auth-site',
    name: 'Auth',
    domain: 'https://auth.example',
    skipSeed: true
  })
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

  assert.equal(resolveAuth('site_revoked_token'), null)
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
  assert.ok(listed.every((u) => !('hash' in u) && !('salt' in u) && !('loginToken' in u)))

  deletePasswordUser({ id: agency.id })
  const after = listPasswordUsers({ site: 'auth-site' })
  assert.equal(after.some((u) => u.id === agency.id), false)
})

test('invite, user token, multi-site agency editor and password reset', () => {
  const editor = registerPasswordUser({
    email: 'editor@example.com',
    invite: true,
    site: 'auth-site',
    sites: ['auth-site'],
    role: 'agency_admin'
  })
  assert.equal(editor.mustSetPassword, true)
  assert.deepEqual(editor.sites, ['auth-site'])

  const minted = mintUserLoginToken({ id: editor.id })
  assert.ok(minted.token.startsWith('user_'))
  const viaToken = resolveAuth(minted.token)
  assert.equal(viaToken.role, 'agency_admin')
  assert.equal(viaToken.site, 'auth-site')
  const publicSession = publicAuthSession(viaToken)
  assert.equal(publicSession.hasLoginToken, true)
  assert.equal(publicSession.loginTokenHint, minted.loginTokenHint)
  assert.equal('loginToken' in publicSession, false)

  const updated = updatePasswordUser({ id: editor.id, email: 'editor-renamed@example.com', sites: ['auth-site', 'other-site'] })
  assert.deepEqual(updated.sites, ['auth-site', 'other-site'])
  assert.equal(updated.email, 'editor-renamed@example.com')

  setUserPassword({ id: editor.id, password: 'newpass123' })
  const session = loginPasswordUser({ email: 'editor-renamed@example.com', password: 'newpass123' })
  const auth = resolveAuth(session.token)
  assert.equal(auth.role, 'agency_admin')
  assert.ok(auth.sites.includes('auth-site'))
  assert.equal(publicAuthSession(auth).mustSetPassword, false)

  revokeUserLoginToken({ id: editor.id })
  assert.equal(resolveAuth(minted.token), null)
})

test('google auth is deferred', () => {
  const status = googleAuthStatus()
  assert.equal(status.available, false)
  assert.equal(status.deferred, true)
})

test('author profile persists and site authors respect publishing permission', () => {
  const owner = registerPasswordUser({
    email: 'author-owner@example.com',
    password: 'secretpass',
    site: 'auth-site',
    role: 'client'
  })
  const colleague = registerPasswordUser({
    email: 'author-colleague@example.com',
    password: 'secretpass',
    site: 'auth-site',
    role: 'client'
  })
  const profile = updateUserProfile({
    id: owner.id,
    displayName: 'Ana Autora',
    bio: 'Contenido y estrategia',
    avatarDataUrl: 'data:image/png;base64,AAAA',
    allowPublishingAs: true
  })
  assert.equal(profile.profileComplete, true)
  assert.equal(profile.displayName, 'Ana Autora')
  assert.equal(profile.allowPublishingAs, true)

  const selfAuthors = listSiteAuthors({ site: 'auth-site', requesterId: colleague.id, requesterRole: 'client' })
  assert.ok(selfAuthors.some((author) => author.name === 'Ana Autora'))
  assert.ok(selfAuthors.some((author) => author.name === 'author-colleague@example.com'))
  assert.equal(selfAuthors.find((author) => author.name === 'Ana Autora')?.canPublishAs, true)

  const invite = mintAuthorInvite({ ownerId: owner.id, site: 'auth-site' })
  const accepted = consumeAuthorInvite({ token: invite.token, userId: colleague.id })
  assert.equal(accepted.ok, true)
  const delegated = listSiteAuthors({ site: 'auth-site', requesterId: colleague.id, requesterRole: 'client' })
  assert.ok(delegated.some((author) => author.name === 'Ana Autora'))
})

test('password auth unavailable when PRODUCT_RESTRUCTURE_V1 off', () => {
  const prev = process.env.PRODUCT_RESTRUCTURE_V1
  process.env.PRODUCT_RESTRUCTURE_V1 = ''
  assert.throws(() => assertPasswordAuthEnabled(), /unavailable/)
  process.env.PRODUCT_RESTRUCTURE_V1 = prev
})
