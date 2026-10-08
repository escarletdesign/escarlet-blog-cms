import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-oauth-site-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.ADMIN_TOKEN = 'oauth-site-admin'
process.env.CMS_PUBLIC_URL = 'https://cms.escarlet.design'
process.env.CMS_SKIP_SEED = '1'
process.env.PRODUCT_RESTRUCTURE_V1 = '1'
process.env.CMS_SKIP_FAVICON = '1'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
mkdirSync(join(dataRoot, 'site-config'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({ sites: [], authors: [], categories: [], media: [], posts: [] })
)

const { createSite } = await import('./create-site.mjs')
const { registerPasswordUser, mintUserLoginToken, loginPasswordUser } = await import('./human-auth.mjs')
const {
  handleAuthorizePost,
  handleToken,
  resolveOAuthAccessToken
} = await import('./oauth-mcp.mjs')

after(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

function pkcePair() {
  const verifier = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

test('OAuth rechaza tokens de sitio revocados', async () => {
  await createSite({
    handle: 'cliente-oauth',
    name: 'Cliente OAuth',
    domain: 'https://cliente-oauth.test',
    skipSeed: true,
    skipFavicon: true
  })
  const { verifier, challenge } = pkcePair()
  const auth = await handleAuthorizePost({
    client_id: 'chatgpt-local',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    response_type: 'code',
    scope: 'mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://cms.escarlet.design/mcp/v3',
    admin_token: 'site_revoked_token'
  })
  assert.equal(auth.status, 401)
})

test('OAuth de Claude rechaza tokens de agencia revocados', async () => {
  const { verifier, challenge } = pkcePair()
  const auth = await handleAuthorizePost({
    client_id: 'claude-local',
    redirect_uri: 'https://claude.com/api/mcp/auth_callback',
    response_type: 'code',
    scope: 'mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://cms.escarlet.design/mcp/v3',
    admin_token: 'agency_revoked_token'
  })
  assert.equal(auth.status, 401)
})

test('OAuth del MCP conserva rol, sitios y usuario para tokens individuales', async () => {
  const user = registerPasswordUser({
    email: 'connector-client@example.com',
    password: 'secretpass',
    site: 'cliente-oauth',
    role: 'client'
  })
  const userToken = mintUserLoginToken({ id: user.id }).token
  const sessionToken = loginPasswordUser({ email: 'connector-client@example.com', password: 'secretpass' }).token

  async function authorize(rawToken, clientId) {
    const { verifier, challenge } = pkcePair()
    const auth = await handleAuthorizePost({
      client_id: clientId,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      response_type: 'code',
      scope: 'mcp',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    resource: 'https://cms.escarlet.design/mcp/v3',
      admin_token: rawToken
    })
    assert.equal(auth.status, 302)
    const code = new URL(auth.location).searchParams.get('code')
    const tokenRes = await handleToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      client_id: clientId,
      code_verifier: verifier,
    resource: 'https://cms.escarlet.design/mcp/v3'
    })
    assert.equal(tokenRes.status, 200)
    return resolveOAuthAccessToken(tokenRes.json.access_token)
  }

  const clientAuth = await authorize(userToken, 'chatgpt-client')
  assert.equal(clientAuth.role, 'client')
  assert.equal(clientAuth.site, 'cliente-oauth')
  assert.deepEqual(clientAuth.sites, ['cliente-oauth'])
  assert.equal(clientAuth.userId, user.id)

  const sessionAuth = await authorize(sessionToken, 'chatgpt-session')
  assert.equal(sessionAuth.role, 'client')
  assert.equal(sessionAuth.userId, user.id)

  const owner = registerPasswordUser({
    email: 'connector-owner@example.com',
    password: 'secretpass',
    sites: ['cliente-oauth'],
    role: 'owner'
  })
  const ownerToken = mintUserLoginToken({ id: owner.id }).token
  const ownerAuth = await authorize(ownerToken, 'chatgpt-owner')
  assert.equal(ownerAuth.role, 'owner')
  assert.equal(ownerAuth.userId, owner.id)
  assert.deepEqual(ownerAuth.sites, ['cliente-oauth'])

})
