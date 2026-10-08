import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  authorizationServerMetadata,
  getAuth0Config,
  handleAuthorizePost,
  handleToken,
  isValidAccessToken,
  isSupportedResource,
  parseFormBody,
  protectedResourceMetadata,
  resolveAuth0AccessToken,
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
  assert.equal(resource.resource, 'https://cms.escarlet.design/mcp/v3')
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
    resource: 'https://cms.escarlet.design/mcp/v3',
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
    resource: 'https://cms.escarlet.design/mcp/v3'
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
    resource: 'https://cms.escarlet.design/mcp/v3',
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
    resource: 'https://cms.escarlet.design/mcp/v3'
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

function signedJwt(privateKey, payload, header = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const encodedHeader = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key', ...header })
  const encodedPayload = encode(payload)
  const signer = createSign('RSA-SHA256')
  signer.update(`${encodedHeader}.${encodedPayload}`)
  signer.end()
  return `${encodedHeader}.${encodedPayload}.${signer.sign(privateKey).toString('base64url')}`
}

test('Auth0 JWT exige configuración completa, firma, issuer, audience y workspace', async () => {
  const previous = {}
  for (const name of ['AUTH0_ENABLED', 'AUTH0_ISSUER', 'AUTH0_AUDIENCE', 'AUTH0_JWKS_URL']) previous[name] = process.env[name]
  const originalFetch = globalThis.fetch
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = 'https://tenant.example.auth0.com'
  const audience = 'https://cms.escarlet.design/mcp/v3'
  const jwksUrl = `${issuer}/.well-known/jwks.json`
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
  process.env.AUTH0_ENABLED = '1'
  process.env.AUTH0_ISSUER = issuer
  process.env.AUTH0_AUDIENCE = audience
  process.env.AUTH0_JWKS_URL = jwksUrl
  globalThis.fetch = async (url) => {
    assert.equal(url, jwksUrl)
    return { ok: true, status: 200, json: async () => ({ keys: [key] }) }
  }
  try {
    const token = signedJwt(privateKey, {
      iss: issuer,
      aud: audience,
      sub: 'auth0|user-1',
      exp: Math.floor(Date.now() / 1000) + 300,
      'https://escarlet.design/user_id': 'user-1',
      'https://escarlet.design/workspace_id': 'workspace-1',
      'https://escarlet.design/site_ids': ['site-1'],
      scope: 'brand:read publication:read ignored:scope'
    })
    const auth = await resolveAuth0AccessToken(token)
    assert.equal(auth.userId, 'user-1')
    assert.equal(auth.workspaceId, 'workspace-1')
    assert.deepEqual(auth.siteIds, ['site-1'])
    assert.deepEqual(auth.permissions, ['brand:read', 'publication:read'])

    const wrongAudience = signedJwt(privateKey, {
      iss: issuer,
      aud: 'https://wrong.example/mcp',
      sub: 'auth0|user-1',
      exp: Math.floor(Date.now() / 1000) + 300,
      'https://escarlet.design/workspace_id': 'workspace-1'
    })
    assert.equal(await resolveAuth0AccessToken(wrongAudience), null)

    const missingWorkspace = signedJwt(privateKey, {
      iss: issuer,
      aud: audience,
      sub: 'auth0|user-1',
      exp: Math.floor(Date.now() / 1000) + 300
    })
    assert.equal(await resolveAuth0AccessToken(missingWorkspace), null)
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('Auth0 parcial queda deshabilitado y el resource legacy no es válido', async () => {
  const previous = {}
  for (const name of ['AUTH0_ENABLED', 'AUTH0_ISSUER', 'AUTH0_AUDIENCE', 'AUTH0_JWKS_URL']) previous[name] = process.env[name]
  try {
    process.env.AUTH0_ENABLED = '1'
    process.env.AUTH0_ISSUER = 'https://tenant.example.auth0.com/'
    delete process.env.AUTH0_AUDIENCE
    delete process.env.AUTH0_JWKS_URL
    const config = getAuth0Config()
    assert.equal(config.enabled, false)
    assert.match(config.error, /AUTH0_ISSUER y AUTH0_AUDIENCE/)
    assert.equal(isSupportedResource('https://cms.escarlet.design/mcp'), false)
    const result = await handleAuthorizePost({
      client_id: 'chatgpt-local',
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      code_challenge: pkcePair().challenge,
      code_challenge_method: 'S256',
      resource: 'https://cms.escarlet.design/mcp',
      admin_token: 'oauth-test-admin'
    })
    assert.equal(result.status, 400)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
