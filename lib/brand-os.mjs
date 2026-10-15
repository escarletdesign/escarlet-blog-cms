const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : []

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max)

const jsonValue = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

const manifestValue = (manifest, ...keys) => {
  for (const key of keys) {
    const value = manifest?.[key]
    if (value !== undefined && value !== null) return jsonValue(value)
  }
  return undefined
}

function normalizeMatch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsRule(copy, rule) {
  const normalizedRule = normalizeMatch(rule)
  if (!normalizedRule) return false
  if (copy.includes(normalizedRule)) return true
  const tokens = normalizedRule.split(' ').filter((token) => token.length > 2)
  return tokens.length > 1 && tokens.every((token) => copy.includes(token))
}

function extractVoiceRules(value) {
  const source = String(value || '')
  const rules = []
  const add = (raw, code = 'unsupported_claim') => {
    for (const item of String(raw || '').split(/[,;|]/)) {
      const rule = item.replace(/^[\s*:_-]+|[\s*.,:_-]+$/g, '').trim()
      if (rule && rule.length > 2) rules.push({ text: rule, code })
    }
  }
  for (const match of source.matchAll(/(?:no usar|prohibido(?:\s+sin evidencia)?)[\s:.-]+([^\n.]+)/giu)) add(match[1], /no usar/iu.test(match[0]) ? 'prohibited_term' : 'unsupported_claim')
  for (const match of source.matchAll(/\*\*No\.\*\*[\s:.-]+([^\n.]+)/giu)) add(match[1], 'unsupported_claim')
  return rules
}

export function normalizeContentBrief(input = {}) {
  const source = asObject(input)
  return {
    objective: text(source.objective, 500),
    audience: text(source.audience, 300),
    idea: text(source.idea || source.mainIdea, 500),
    channels: asArray(source.channels).map((value) => text(value, 40).toLowerCase()).filter(Boolean),
    format: text(source.format, 120),
    cta: text(source.cta, 300),
    sources: asArray(source.sources).map((value) => text(value, 500)).filter(Boolean),
    constraints: asArray(source.constraints).map((value) => text(value, 500)).filter(Boolean),
    language: text(source.language || 'es', 20),
    approvalPolicy: 'human_required'
  }
}

export function normalizeBrandContextSummary({ site, brandKitVersionId, brandKitVersion, brandKitSnapshotHash, manifest = {} } = {}) {
  const core = asObject(manifestValue(manifest, 'brand-core.json', 'brand-core'))
  const profile = { ...asObject(core.brandProfile), ...asObject(manifestValue(manifest, 'brand-profile.json', 'brand-profile', 'brandContext')) }
  const content = { ...asObject(core.content), ...asObject(manifestValue(manifest, 'content-rules.json', 'content-rules')) }
  const identity = asObject(core.identity || profile.identity)
  const audience = asArray(profile.audience || profile.audiences || content.audience || content.audiences)
  const pillars = asArray(profile.editorialPillars || profile.pillars || content.editorialPillars || content.pillars)
  const claims = asArray(profile.claims || content.claims || core.claims).map((claim) => {
    const value = typeof claim === 'string' ? { text: claim } : asObject(claim)
    return {
      id: text(value.id || value.key || value.text, 120),
      text: text(value.text || value.claim || value.value, 500),
      status: text(value.status || 'draft', 30).toLowerCase(),
      source: text(value.source || value.evidence || '', 500),
      expiresAt: text(value.expiresAt || value.expires_at || '', 40)
    }
  }).filter((claim) => claim.text)
  const prohibitedTerms = asArray(profile.prohibitedTerms || content.prohibitedTerms || content.avoid)
    .map((value) => text(value, 80).toLowerCase()).filter(Boolean)
  const voiceRules = extractVoiceRules(manifestValue(manifest, 'voice.md', 'voice'))
  const voiceProhibitedTerms = voiceRules.filter((rule) => rule.code === 'prohibited_term').map((rule) => rule.text)
  const voiceUnsupportedClaims = voiceRules.filter((rule) => rule.code === 'unsupported_claim').map((rule) => rule.text)
  return {
    site: text(site, 120),
    brandKitVersionId: text(brandKitVersionId, 160),
    brandKitVersion: brandKitVersion ?? null,
    brandKitSnapshotHash: text(brandKitSnapshotHash, 160),
    identity: { name: text(identity.name || profile.name || '', 200) },
    audience: audience.map((value) => typeof value === 'string' ? value : text(value.name || value.label || value.description, 300)).filter(Boolean),
    editorialPillars: pillars.map((value) => typeof value === 'string' ? value : text(value.name || value.label || value.title, 200)).filter(Boolean),
    hasVoice: Boolean(manifest['voice.md'] || profile.voice || content.voice || core.identity?.editorialTone),
    claims,
    prohibitedTerms: [...new Set([...prohibitedTerms, ...voiceProhibitedTerms].map(normalizeMatch).filter(Boolean))],
    unsupportedClaims: [...new Set(voiceUnsupportedClaims.map(normalizeMatch).filter(Boolean))],
    requiresHumanApproval: true
  }
}

export function findBrandRuleFindings({ brief = {}, variants = {}, brandContext = {} } = {}) {
  const findings = []
  const normalizedBrief = normalizeContentBrief(brief)
  const copy = Object.values(asObject(variants)).map((variant) => {
    const body = asObject(variant)
    return [body.title, body.excerpt, body.body, body.bodyHtml, body.caption, body.script].filter(Boolean).join(' ')
  }).join(' ')
  const normalizedCopy = normalizeMatch(copy)
  for (const term of brandContext.prohibitedTerms || []) {
    if (containsRule(normalizedCopy, term)) findings.push({ code: 'prohibited_term', severity: 'blocker', message: `El contenido usa un término no permitido: ${term}.`, rule: 'prohibitedTerms' })
  }
  for (const claim of brandContext.unsupportedClaims || []) {
    if (containsRule(normalizedCopy, claim)) findings.push({ code: 'unsupported_claim', severity: 'blocker', message: `El contenido usa una promesa o claim sin evidencia: ${claim}.`, rule: 'claims.evidence' })
  }
  const approvedClaims = (brandContext.claims || []).filter((claim) => claim.status === 'approved' && claim.text).map((claim) => claim.text.toLowerCase())
  const draftClaims = (brandContext.claims || []).filter((claim) => claim.status !== 'approved' && claim.text)
  for (const claim of draftClaims) {
    if (containsRule(normalizedCopy, claim.text)) findings.push({ code: 'claim_requires_review', severity: 'blocker', message: `El claim necesita aprobación o fuente: ${claim.text}.`, rule: 'claims.status' })
  }
  if (normalizedBrief.cta && !normalizedCopy.includes(normalizeMatch(normalizedBrief.cta))) findings.push({ code: 'cta_not_detected', severity: 'warning', message: 'El CTA del brief no aparece de forma visible en las variantes.', rule: 'brief.cta' })
  if (!normalizedBrief.audience) findings.push({ code: 'audience_missing', severity: 'warning', message: 'El brief no define una audiencia.', rule: 'brief.audience' })
  if (!brandContext.hasVoice) findings.push({ code: 'voice_missing', severity: 'warning', message: 'La versión activa no tiene una guía de voz disponible.', rule: 'brand.voice' })
  if (approvedClaims.length && !approvedClaims.some((claim) => normalizedCopy.includes(normalizeMatch(claim)))) findings.push({ code: 'approved_claim_not_used', severity: 'suggestion', message: 'Ningún claim aprobado aparece en las variantes.', rule: 'claims.approved' })
  return findings
}

export function buildBrandOsMetadata({ site, brandKitVersionId, brandKitVersion, brandKitSnapshotHash, manifest, brief, variants } = {}) {
  const brandContext = normalizeBrandContextSummary({ site, brandKitVersionId, brandKitVersion, brandKitSnapshotHash, manifest })
  const contentBrief = normalizeContentBrief(brief)
  return {
    brandContext,
    contentBrief,
    findings: findBrandRuleFindings({ brief: contentBrief, variants, brandContext }),
    generationPolicy: { provider: 'mcp', serverSideGeneration: false, approval: 'human_required' }
  }
}
