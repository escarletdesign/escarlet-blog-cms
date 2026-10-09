import test from 'node:test'
import assert from 'node:assert/strict'
import { getAuth0UiConfig } from './auth0-ui.mjs'

function withEnv(values, callback) {
  const previous = new Map()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return callback()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('Auth0 UI remains disabled unless explicitly enabled', () => {
  withEnv({ AUTH0_UI_ENABLED: undefined, AUTH0_DOMAIN: undefined, AUTH0_CLIENT_ID: undefined, AUTH0_CLIENT_SECRET: undefined }, () => {
    const config = getAuth0UiConfig()
    assert.equal(config.enabled, false)
    assert.equal(config.configured, false)
  })
})

test('Auth0 UI rejects an enabled configuration without its client secret', () => {
  withEnv({
    AUTH0_UI_ENABLED: '1',
    AUTH0_DOMAIN: 'dev-example.us.auth0.com',
    AUTH0_CLIENT_ID: 'client-id',
    AUTH0_CLIENT_SECRET: undefined,
    AUTH0_UI_CALLBACK_URL: 'https://cms.example.com/api/auth0/callback',
    AUTH0_UI_LOGOUT_URL: 'https://cms.example.com/app'
  }, () => {
    const config = getAuth0UiConfig()
    assert.equal(config.enabled, false)
    assert.match(config.error, /AUTH0_CLIENT_SECRET/)
  })
})
