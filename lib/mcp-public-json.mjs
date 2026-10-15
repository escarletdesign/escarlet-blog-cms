const RENAMES = {
  batch_id: 'batchId',
  workspace_id: 'workspaceId',
  site_id: 'siteId',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  publication_date: 'publicationDate',
  scheduled_at: 'scheduledAt',
  published_at: 'publishedAt',
  total_items: 'totalItems',
  generated_items: 'generatedItems',
  failed_items: 'failedItems',
  ready_count: 'readyCount',
  item_count: 'itemCount',
  error_count: 'errorCount',
  plan_title: 'planTitle',
  plan_status: 'planStatus',
  site_handle: 'siteHandle',
  site_name: 'siteName',
  content_title: 'contentTitle',
  workflow_revision: 'workflowRevision',
  owner_id: 'ownerId',
  brand_kit_version_id: 'brandKitVersionId',
  created_by: 'createdBy',
  item_id: 'itemId',
  variant_id: 'variantId',
  last_error: 'lastError',
  user_id: 'userId',
  storage_key: 'storageKey',
  public_url: 'publicUrl',
  content_type: 'contentType',
  size_bytes: 'sizeBytes'
}

const PRESERVE_KEYS = new Set(['body', 'metadata', 'visualBrief', 'manifest', 'config', 'credentials'])

export function toIso(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object' && typeof value.toISOString === 'function' && !Array.isArray(value)) {
    try {
      const iso = value.toISOString()
      if (typeof iso === 'string' && iso.includes('T')) return iso
    } catch {
      // Not a date. Walk it as a plain object.
    }
  }
  return value
}

export function toIsoDeep(value) {
  const iso = toIso(value)
  if (iso !== value) return iso
  if (Array.isArray(value)) return value.map((item) => toIsoDeep(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toIsoDeep(child)]))
}

export function toMcpPublic(value, parentKey = '') {
  const iso = toIso(value)
  if (iso !== value) return iso
  if (Array.isArray(value)) return value.map((item) => toMcpPublic(item, parentKey))
  if (!value || typeof value !== 'object') return value
  if (PRESERVE_KEYS.has(parentKey)) return toIsoDeep(value)
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    const nextKey = RENAMES[key] || key
    const nextValue = toMcpPublic(child, key)
    if (Object.prototype.hasOwnProperty.call(out, nextKey) && key !== nextKey) continue
    out[nextKey] = nextValue
  }
  return out
}

export function summarizeMcpPayload(response) {
  if (!response || typeof response !== 'object') return String(response ?? '')
  if (Array.isArray(response.items)) return `${response.items.length} items encontrados.`
  if (Array.isArray(response.variants) && response.id) return `Item ${response.id}: ${response.status || 'sin estado'}.`
  if (Array.isArray(response.plans)) return `${response.plans.length} campañas encontradas.`
  if (Array.isArray(response.entries)) return `${response.entries.length} entradas de calendario.`
  if (Array.isArray(response.workspaces)) {
    const brands = response.workspaces.reduce((count, workspace) => count + (Array.isArray(workspace.sites) ? workspace.sites.length : 0), 0)
    return `${response.workspaces.length} workspaces, ${brands} marcas.`
  }
  if (Array.isArray(response.brands)) return `${response.brands.length} marcas visibles.`
  if (response.message && response.code) return `${response.message} [${response.code}]`
  if (response.itemId && response.status) return `Item ${response.itemId}: ${response.status}.`
  if (response.batchId && response.status) return `Campaña ${response.batchId}: ${response.status}.`
  if (response.id && response.status) return `${response.status}.`
  const keys = Object.keys(response).filter((key) => key !== 'mcpServer').slice(0, 5)
  return keys.length ? `OK (${keys.join(', ')}).` : 'OK.'
}

export function mcpToolResult(payload, server) {
  const safe = toMcpPublic(payload)
  const response = safe && typeof safe === 'object' && !Array.isArray(safe)
    ? { ...safe, mcpServer: { name: server.name, version: server.version, contract: server.contract, canonicalUrl: server.canonicalUrl } }
    : safe
  const text = response && typeof response === 'object' && !Array.isArray(response)
    ? summarizeMcpPayload(response)
    : typeof response === 'string' ? response : JSON.stringify(toIsoDeep(response))
  return {
    content: [{ type: 'text', text }],
    ...(response && typeof response === 'object' && !Array.isArray(response) ? { structuredContent: response } : {})
  }
}
