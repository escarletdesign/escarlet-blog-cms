import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  authorizationServerMetadata,
  handleAuthorizePost,
  handleToken,
  isValidAccessToken,
  parseFormBody,
  protectedResourceMetadata,
  wwwAuthenticateHeader
} from './oauth-mcp.mjs'

const dir = mkdtempSync(join(tmpdir(), 'cms-oauth-'))
process.env.CMS_DATA_DIR = dir
process.env.ADMIN_TOKEN = 'oauth-test-admin'
process.env.CMS_PUBLIC_URL = 'https://blog-cms.escarlet.cc'

after(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CMS_DATA_DIR
})

function pkcePair() {
  const verifier = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

test('metadata OAuth apunta al mismo host', () => {
  const resource = protectedResourceMetadata()
  const as = authorizationServerMetadata()
  assert.equal(resource.resource, 'https://blog-cms.escarlet.cc/mcp')
  assert.deepEqual(resource.authorization_servers, ['https://blog-cms.escarlet.cc'])
  assert.equal(as.authorization_endpoint, 'https://blog-cms.escarlet.cc/oauth/authorize')
  assert.equal(as.token_endpoint, 'https://blog-cms.escarlet.cc/oauth/token')
  assert.ok(as.code_challenge_methods_supported.includes('S256'))
  assert.match(wwwAuthenticateHeader(), /resource_metadata=/)
})

test('parseFormBody lee application/x-www-form-urlencoded', () => {
  const body = parseFormBody('grant_type=authorization_code&code=abc')
  assert.equal(body.grant_type, 'authorization_code')
  assert.equal(body.code, 'abc')
})

test('flujo authorize + token con PKCE S256', async () => {
  const { verifier, challenge } = pkcePair()
  const clientId = 'chatgpt-local'
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect'

  const auth = await handleAuthorizePost({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'mcp',
    state: 'xyz',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://blog-cms.escarlet.cc/mcp',
    admin_token: 'oauth-test-admin'
  })
  assert.equal(auth.status, 302)
  assert.ok(auth.location)
  const loc = new URL(auth.location)
  assert.equal(loc.origin + loc.pathname, redirectUri)
  assert.equal(loc.searchParams.get('state'), 'xyz')
  assert.equal(loc.searchParams.get('iss'), 'https://blog-cms.escarlet.cc')
  const code = loc.searchParams.get('code')
  assert.ok(code)

  const tokenRes = await handleToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: 'https://blog-cms.escarlet.cc/mcp'
  })
  assert.equal(tokenRes.status, 200)
  assert.equal(tokenRes.json.token_type, 'bearer')
  assert.ok(tokenRes.json.access_token)
  assert.ok(tokenRes.json.refresh_token)
  assert.ok(isValidAccessToken(tokenRes.json.access_token))
  assert.equal(isValidAccessToken(tokenRes.json.refresh_token), false)
})

test('token admin incorrecto no emite code', async () => {
  const { challenge } = pkcePair()
  const result = await handleAuthorizePost({
    client_id: 'chatgpt-local',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    admin_token: 'wrong'
  })
  assert.equal(result.status, 401)
  assert.ok(result.html.includes('Token incorrecto'))
})

test('OAuth acepta token de sitio y queda acotado', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const siteDir = join(dir, 'site-config')
  mkdirSync(siteDir, { recursive: true })
  writeFileSync(
    join(siteDir, 'cliente-oauth.json'),
    JSON.stringify({ domain: 'https://cliente.test', siteAccessToken: 'site_oauth_test_token' })
  )
  mkdirSync(join(dir, 'sites'), { recursive: true })

  const { verifier, challenge } = pkcePair()
  const auth = await handleAuthorizePost({
    client_id: 'chatgpt-local',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    response_type: 'code',
    scope: 'mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://blog-cms.escarlet.cc/mcp',
    admin_token: 'site_oauth_test_token'
  })
  assert.equal(auth.status, 302)
  const code = new URL(auth.location).searchParams.get('code')
  const tokenRes = await handleToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    client_id: 'chatgpt-local',
    code_verifier: verifier,
    resource: 'https://blog-cms.escarlet.cc/mcp'
  })
  assert.equal(tokenRes.status, 200)
  const { resolveOAuthAccessToken } = await import('./oauth-mcp.mjs')
  const session = resolveOAuthAccessToken(tokenRes.json.access_token)
  assert.equal(session.role, 'site')
  assert.equal(session.site, 'cliente-oauth')
})
