import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBrandOsMetadata, findBrandRuleFindings, normalizeContentBrief, normalizeBrandContextSummary } from './brand-os.mjs'

test('normaliza un brief y fuerza aprobación humana', () => {
  const brief = normalizeContentBrief({ objective: 'Educar', channels: ['Blog', 'INSTAGRAM'], sources: ['https://example.test'] })
  assert.deepEqual(brief.channels, ['blog', 'instagram'])
  assert.equal(brief.approvalPolicy, 'human_required')
})

test('construye contexto versionado y detecta claims no aprobados', () => {
  const metadata = buildBrandOsMetadata({
    site: 'demo', brandKitVersionId: 'kit-1', brandKitVersion: 3, brandKitSnapshotHash: 'hash-1',
    manifest: { 'brand-core.json': { identity: { name: 'Demo' }, claims: [{ text: 'Somos líderes', status: 'draft' }] }, 'voice.md': '# Voz' },
    brief: { audience: 'Clientes', cta: 'Conoce más' }, variants: { blog: { body: 'Somos líderes en el sector.' } }
  })
  assert.equal(metadata.brandContext.brandKitVersionId, 'kit-1')
  assert.equal(metadata.brandContext.identity.name, 'Demo')
  assert.equal(metadata.findings[0].code, 'claim_requires_review')
  assert.equal(metadata.findings[0].severity, 'blocker')
})

test('marca términos prohibidos como bloqueos', () => {
  const context = normalizeBrandContextSummary({ site: 'demo', manifest: { 'content-rules.json': { prohibitedTerms: ['barata'] } } })
  const findings = findBrandRuleFindings({ brandContext: context, variants: { blog: { body: 'La opción barata para todos.' } } })
  assert.equal(findings[0].code, 'prohibited_term')
  assert.equal(findings[0].severity, 'blocker')
})

const voice = 'No usar premium.\nProhibido sin evidencia: resultados garantizados, multiplicamos ventas, número uno, libertad financiera.'

test('copy.validate bloquea reglas de voz aunque falte audiencia', () => {
  const result = buildBrandOsMetadata({
    manifest: { 'voice.md': voice },
    brief: {},
    variants: { input: { body: 'Somos la agencia premium número uno. Multiplicamos tus ventas y garantizamos libertad financiera.' } }
  })
  assert.equal(result.findings.some((finding) => finding.code === 'prohibited_term'), true)
  assert.equal(result.findings.filter((finding) => finding.code === 'unsupported_claim').length >= 3, true)
  assert.equal(result.findings.some((finding) => finding.code === 'audience_missing' && finding.severity === 'warning'), true)
})

test('copy.validate acepta copy editorial sin claims prohibidos', () => {
  const result = buildBrandOsMetadata({
    manifest: { 'voice.md': voice },
    brief: { audience: 'personas que buscan una agencia creativa' },
    variants: { input: { body: 'Diseñamos una presencia digital clara, cercana y útil para tu equipo.' } }
  })
  assert.equal(result.findings.some((finding) => finding.severity === 'blocker'), false)
})
