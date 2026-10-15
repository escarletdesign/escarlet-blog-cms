export const ESCARLET_OS_CONTRACT_VERSION = 'production.v1'

export const CAPABILITY_KINDS = Object.freeze(['primitive', 'recipe'])
export const CAPABILITY_VISIBILITIES = Object.freeze(['public', 'internal'])
export const CAPABILITY_REVIEW_POLICIES = Object.freeze(['none', 'human_optional', 'human_required'])

const ID_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export class CapabilityManifestError extends TypeError {
  constructor(message, code = 'CAPABILITY_MANIFEST_INVALID', details = {}) {
    super(message)
    this.name = 'CapabilityManifestError'
    this.code = code
    this.details = details
  }
}

function fail(message, code, details) {
  throw new CapabilityManifestError(message, code, details)
}

function nonEmptyText(value, field, { max = 2000 } = {}) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} es obligatorio.`, 'CAPABILITY_MANIFEST_FIELD_REQUIRED', { field })
  const result = value.trim()
  if (result.length > max) fail(`${field} supera el máximo permitido.`, 'CAPABILITY_MANIFEST_FIELD_TOO_LONG', { field, max })
  return result
}

function textList(value, field, { required = false, maxItems = 100, maxItemLength = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${field} es obligatorio.`, 'CAPABILITY_MANIFEST_FIELD_REQUIRED', { field })
    return []
  }
  if (!Array.isArray(value)) fail(`${field} debe ser una lista.`, 'CAPABILITY_MANIFEST_LIST_INVALID', { field })
  if (value.length > maxItems) fail(`${field} supera el número máximo de elementos.`, 'CAPABILITY_MANIFEST_LIST_TOO_LONG', { field, maxItems })
  const seen = new Set()
  return value.map((item, index) => {
    const result = nonEmptyText(item, `${field}[${index}]`, { max: maxItemLength })
    if (seen.has(result)) fail(`${field} contiene valores duplicados.`, 'CAPABILITY_MANIFEST_LIST_DUPLICATE', { field, value: result })
    seen.add(result)
    return result
  })
}

function plainObject(value, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${field} es obligatorio.`, 'CAPABILITY_MANIFEST_FIELD_REQUIRED', { field })
    return {}
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} debe ser un objeto.`, 'CAPABILITY_MANIFEST_OBJECT_INVALID', { field })
  }
  return value
}

function cloneAndFreeze(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const clone = Array.isArray(value) ? [] : {}
  seen.set(value, clone)
  for (const [key, child] of Object.entries(value)) clone[key] = cloneAndFreeze(child, seen)
  return Object.freeze(clone)
}

function normalizeErrors(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail('errors debe ser una lista.', 'CAPABILITY_MANIFEST_LIST_INVALID', { field: 'errors' })
  return value.map((entry, index) => {
    const source = plainObject(entry, `errors[${index}]`, { required: true })
    const code = nonEmptyText(source.code, `errors[${index}].code`, { max: 120 })
    if (typeof source.retryable !== 'boolean') {
      fail(`errors[${index}].retryable debe ser booleano.`, 'CAPABILITY_MANIFEST_BOOLEAN_INVALID', { field: `errors[${index}].retryable` })
    }
    return { code, retryable: source.retryable, description: source.description ? nonEmptyText(source.description, `errors[${index}].description`, { max: 500 }) : '' }
  })
}

function assertSchema(value, field) {
  const schema = plainObject(value, field, { required: true })
  if (typeof schema.type !== 'string' || !schema.type.trim()) {
    fail(`${field}.type es obligatorio.`, 'CAPABILITY_MANIFEST_SCHEMA_INVALID', { field })
  }
  return schema
}

export function compareCapabilityVersions(left, right) {
  const parse = (version) => {
    const [main, pre = ''] = String(version).split('-', 2)
    const [major, minor, patch] = main.split('.').map(Number)
    return { major, minor, patch, pre }
  }
  const a = parse(left)
  const b = parse(right)
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (a.pre === b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  const aParts = a.pre.split('.')
  const bParts = b.pre.split('.')
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    if (aParts[index] === undefined) return -1
    if (bParts[index] === undefined) return 1
    if (aParts[index] === bParts[index]) continue
    const aNumeric = /^\d+$/.test(aParts[index])
    const bNumeric = /^\d+$/.test(bParts[index])
    if (aNumeric && bNumeric) return Number(aParts[index]) > Number(bParts[index]) ? 1 : -1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return aParts[index] > bParts[index] ? 1 : -1
  }
  return 0
}

export function normalizeCapabilityManifest(input = {}) {
  const source = plainObject(input, 'manifest', { required: true })
  const id = nonEmptyText(source.id, 'id', { max: 120 })
  if (!ID_PATTERN.test(id)) fail('id debe usar nombres semánticos separados por puntos.', 'CAPABILITY_MANIFEST_ID_INVALID', { id })
  const version = nonEmptyText(source.version, 'version', { max: 40 })
  if (!VERSION_PATTERN.test(version)) fail('version debe usar semver, por ejemplo 1.0.0.', 'CAPABILITY_MANIFEST_VERSION_INVALID', { version })
  const kind = nonEmptyText(source.kind, 'kind', { max: 30 })
  if (!CAPABILITY_KINDS.includes(kind)) fail('kind no está soportado.', 'CAPABILITY_MANIFEST_KIND_INVALID', { kind })
  const visibility = source.visibility === undefined ? 'public' : nonEmptyText(source.visibility, 'visibility', { max: 30 })
  if (!CAPABILITY_VISIBILITIES.includes(visibility)) fail('visibility no está soportada.', 'CAPABILITY_MANIFEST_VISIBILITY_INVALID', { visibility })
  const reviewPolicy = source.reviewPolicy === undefined ? 'none' : nonEmptyText(source.reviewPolicy, 'reviewPolicy', { max: 40 })
  if (!CAPABILITY_REVIEW_POLICIES.includes(reviewPolicy)) fail('reviewPolicy no está soportada.', 'CAPABILITY_MANIFEST_REVIEW_POLICY_INVALID', { reviewPolicy })
  const dependencies = textList(source.dependencies, 'dependencies', { maxItemLength: 120 })
  if (kind === 'recipe' && !dependencies.length) fail('Una recipe debe declarar dependencies.', 'CAPABILITY_MANIFEST_DEPENDENCIES_REQUIRED', { id })
  const permissions = textList(source.permissions, 'permissions', { required: true, maxItemLength: 120 })
  const handler = source.handler === undefined || source.handler === null ? null : nonEmptyText(source.handler, 'handler', { max: 200 })
  const manifest = {
    contractVersion: source.contractVersion === undefined ? ESCARLET_OS_CONTRACT_VERSION : nonEmptyText(source.contractVersion, 'contractVersion', { max: 40 }),
    id,
    version,
    kind,
    visibility,
    title: nonEmptyText(source.title, 'title', { max: 160 }),
    description: nonEmptyText(source.description, 'description', { max: 2000 }),
    handler,
    tags: textList(source.tags, 'tags', { maxItemLength: 80 }),
    useCases: textList(source.useCases, 'useCases', { maxItemLength: 300 }),
    permissions,
    dependencies,
    sideEffects: textList(source.sideEffects, 'sideEffects', { maxItemLength: 120 }),
    reviewPolicy,
    inputSchema: assertSchema(source.inputSchema, 'inputSchema'),
    outputSchema: assertSchema(source.outputSchema, 'outputSchema'),
    errors: normalizeErrors(source.errors),
    deprecated: source.deprecated === true,
    metadata: plainObject(source.metadata, 'metadata')
  }
  if (source.deprecated !== undefined && typeof source.deprecated !== 'boolean') {
    fail('deprecated debe ser booleano.', 'CAPABILITY_MANIFEST_BOOLEAN_INVALID', { field: 'deprecated' })
  }
  return cloneAndFreeze(manifest)
}

export function hasCapabilityPermissions(manifest, grantedPermissions = []) {
  const granted = new Set(Array.isArray(grantedPermissions) ? grantedPermissions : [])
  return manifest.permissions.every((permission) => granted.has(permission) || granted.has('*'))
}

export function capabilityKey(id, version) {
  return `${id}@${version}`
}
