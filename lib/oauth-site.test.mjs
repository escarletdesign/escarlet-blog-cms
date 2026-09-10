import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-oauth-site-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.ADMIN_TOKEN = 'oauth-site-admin'
process.env.CMS_PUBLIC_URL = 'https://blog-cms.escarlet.cc'
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
const { saveSiteConfig } = await import('./site-config.mjs')
const { generateSiteAccessToken, generateAgencyAccessToken } = await import('./auth.mjs')
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

let siteToken = ''

test('OAuth acepta token de sitio y queda acotado al handle', async () => {
  await createSite({
    handle: 'cliente-oauth',
    name: 'Cliente OAuth',
    domain: 'https://cliente-oauth.test',
    skipSeed: true,
    skipFavicon: true
  })
  siteToken = generateSiteAccessToken()
  saveSiteConfig('cliente-oauth', { siteAccessToken: siteToken })

  const { verifier, challenge } = pkcePair()
  const auth = await handleAuthorizePost({
    client_id: 'chatgpt-local',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    response_type: 'code',
    scope: 'mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://blog-cms.escarlet.cc/mcp',
    admin_token: siteToken
  })
  assert.equal(auth.status, 302)
  const code = new URL(auth.location).searchParams.get('code')
  assert.ok(code)

  const tokenRes = await handleToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    client_id: 'chatgpt-local',
    code_verifier: verifier,
    resource: 'https://blog-cms.escarlet.cc/mcp'
  })
  assert.equal(tokenRes.status, 200)
  const session = resolveOAuthAccessToken(tokenRes.json.access_token)
  assert.equal(session.role, 'site')
  assert.equal(session.site, 'cliente-oauth')
})

test('OAuth de Claude acepta token de sitio y queda acotado al handle', async () => {
  const { verifier, challenge } = pkcePair()
  const auth = await handleAuthorizePost({
    client_id: 'claude-local',
    redirect_uri: 'https://claude.com/api/mcp/auth_callback',
    response_type: 'code',
    scope: 'mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://blog-cms.escarlet.cc/mcp',
    admin_token: siteToken
  })
  assert.equal(auth.status, 302)
  const code = new URL(auth.location).searchParams.get('code')
  assert.ok(code)

  const tokenRes = await handleToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'https://claude.com/api/mcp/auth_callback',
    client_id: 'claude-local',
    code_verifier: verifier,
    resource: 'https://blog-cms.escarlet.cc/mcp'
  })
  assert.equal(tokenRes.status, 200)
  const session = resolveOAuthAccessToken(tokenRes.json.access_token)
  assert.equal(session.role, 'site')
  assert.equal(session.site, 'cliente-oauth')
})

test('OAuth del MCP conserva rol, sitios y usuario para tokens individuales', async () => {
  const agencyToken = generateAgencyAccessToken()
  saveSiteConfig('cliente-oauth', { agencyAccessToken: agencyToken })
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
      resource: 'https://blog-cms.escarlet.cc/mcp',
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
      resource: 'https://blog-cms.escarlet.cc/mcp'
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

  const agencyAuth = await authorize(agencyToken, 'chatgpt-agency')
  assert.equal(agencyAuth.role, 'agency_admin')
  assert.equal(agencyAuth.site, 'cliente-oauth')
  assert.deepEqual(agencyAuth.sites, ['cliente-oauth'])
})
