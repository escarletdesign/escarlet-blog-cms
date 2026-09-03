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
process.env.CMS_SKIP_FAVICON = '1'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
mkdirSync(join(dataRoot, 'site-config'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({ sites: [], authors: [], categories: [], media: [], posts: [] })
)

const { createSite } = await import('./create-site.mjs')
const { saveSiteConfig } = await import('./site-config.mjs')
const { generateSiteAccessToken } = await import('./auth.mjs')
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

test('OAuth acepta token de sitio y queda acotado al handle', async () => {
  await createSite({
    handle: 'cliente-oauth',
    name: 'Cliente OAuth',
    domain: 'https://cliente-oauth.test',
    skipSeed: true,
    skipFavicon: true
  })
  const siteToken = generateSiteAccessToken()
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
