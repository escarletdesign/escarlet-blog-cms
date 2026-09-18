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
process.env.CMS_PUBLIC_URL = 'https://cms.escarlet.design'

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
  assert.equal(resource.resource, 'https://cms.escarlet.design/mcp')
  assert.deepEqual(resource.authorization_servers, ['https://cms.escarlet.design'])
  assert.equal(as.authorization_endpoint, 'https://cms.escarlet.design/oauth/authorize')
  assert.equal(as.token_endpoint, 'https://cms.escarlet.design/oauth/token')
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
    resource: 'https://cms.escarlet.design/mcp',
    admin_token: 'oauth-test-admin'
  })
  assert.equal(auth.status, 302)
  assert.ok(auth.location)
  const loc = new URL(auth.location)
  assert.equal(loc.origin + loc.pathname, redirectUri)
  assert.equal(loc.searchParams.get('state'), 'xyz')
  assert.equal(loc.searchParams.get('iss'), 'https://cms.escarlet.design')
  const code = loc.searchParams.get('code')
  assert.ok(code)

  const tokenRes = await handleToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: 'https://cms.escarlet.design/mcp'
  })
  assert.equal(tokenRes.status, 200)
  assert.equal(tokenRes.json.token_type, 'bearer')
  assert.ok(tokenRes.json.access_token)
  assert.ok(tokenRes.json.refresh_token)
  assert.ok(isValidAccessToken(tokenRes.json.access_token))
  assert.equal(isValidAccessToken(tokenRes.json.refresh_token), false)
})

test('flujo authorize + token con redirect de Claude', async () => {
  const { verifier, challenge } = pkcePair()
  const clientId = 'claude-local'
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback'

  const auth = await handleAuthorizePost({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'mcp',
    state: 'claude-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://cms.escarlet.design/mcp',
    admin_token: 'oauth-test-admin'
  })
  assert.equal(auth.status, 302)
  const loc = new URL(auth.location)
  assert.equal(loc.origin + loc.pathname, redirectUri)
  assert.equal(loc.searchParams.get('state'), 'claude-state')
  const code = loc.searchParams.get('code')
  assert.ok(code)

  const tokenRes = await handleToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: 'https://cms.escarlet.design/mcp'
  })
  assert.equal(tokenRes.status, 200)
  assert.ok(tokenRes.json.access_token)
  assert.ok(isValidAccessToken(tokenRes.json.access_token))
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
