import { randomUUID } from 'node:crypto'
import { getPgPool, runCoreMigrations, withPgTransaction } from './pg.mjs'

export const CONTENT_CHANNELS = Object.freeze(['blog', 'instagram', 'linkedin', 'x', 'video', 'substack'])
export const CONTENT_STATUSES = Object.freeze(['draft', 'generated', 'needs_review', 'approved', 'scheduled', 'syncing', 'published', 'failed', 'canceled'])
export const WORKSPACE_ROLES = Object.freeze(['owner', 'admin', 'editor', 'author', 'viewer'])
export const BRAND_CAPABILITIES = Object.freeze([
  'brand_kit_access',
  'content_publishing',
  'blog_publishing',
  'presentation_generation',
  'review_content',
  'approve_content',
  'schedule_content',
  'manage_connections',
  'manage_members',
  'manage_billing'
])
export const CHANNEL_CATALOG = Object.freeze([
  { id: 'blog', label: 'Blog', connectionRequired: true, provider: 'web' },
  { id: 'instagram', label: 'Instagram', connectionRequired: true, provider: 'metricool' },
  { id: 'linkedin', label: 'LinkedIn', connectionRequired: true, provider: 'metricool' },
  { id: 'x', label: 'X', connectionRequired: true, provider: 'metricool' },
  { id: 'video', label: 'Vídeo', connectionRequired: true, provider: 'metricool' },
  { id: 'substack', label: 'Substack', connectionRequired: true, provider: 'metricool' }
])
const DEFAULT_BRAND_CAPABILITIES = Object.freeze({
  brand_kit_access: true,
  content_publishing: false,
  blog_publishing: false,
  presentation_generation: false
})

function text(value, max = 500) { return String(value ?? '').trim().slice(0, max) }
function required(value, label, max = 500) {
  const out = text(value, max)
  if (!out) throw Object.assign(new Error(`${label} es obligatorio.`), { status: 400 })
  return out
}
function id(value) { return text(value, 160) || randomUUID() }
function jsonObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function period(now = new Date()) { return now.toISOString().slice(0, 7) }
function dbUnavailable() { return Object.assign(new Error('Postgres no está configurado.'), { status: 503, code: 'postgres_required' }) }
async function poolOrThrow() {
  const pool = await getPgPool()
  if (!pool) throw dbUnavailable()
  await runCoreMigrations()
  return pool
}

const DEFAULT_USAGE_LIMITS = Object.freeze({ content_items_created: 1000, generations: 1000, media_uploads: 500, publications: 500, external_syncs: 500 })

function membershipIsBlocked(row) {
  if (!row) return false
  const status = String(row.status || '').toLowerCase()
  if (['suspended', 'canceled', 'unpaid', 'past_due', 'incomplete_expired'].includes(status)) return true
  if (row.currentPeriodEnd) {
    const expiresAt = new Date(row.currentPeriodEnd).getTime()
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return true
  }
  return false
}

export async function assertUsageCapacity({ workspaceId, kind, quantity = 1 } = {}) {
  const pool = await poolOrThrow()
  const currentPeriod = period()
  const [counter, entitlement] = await Promise.all([
    pool.query('SELECT quantity FROM usage_counters WHERE workspace_id=$1 AND period=$2 AND kind=$3', [workspaceId, currentPeriod, kind]),
    pool.query('SELECT value FROM entitlements WHERE workspace_id=$1 AND key IN ($2,$3) ORDER BY updated_at DESC LIMIT 1', [workspaceId, `quota:${kind}`, 'quota'])
  ])
  const value = entitlement.rows[0]?.value && typeof entitlement.rows[0].value === 'object' ? entitlement.rows[0].value : {}
  const limit = Number(value.limit ?? value[kind] ?? DEFAULT_USAGE_LIMITS[kind] ?? 0)
  const used = Number(counter.rows[0]?.quantity || 0)
  if (limit > 0 && used + Number(quantity) > limit) throw Object.assign(new Error('Cuota del workspace agotada.'), { status: 429, code: 'QUOTA_EXCEEDED', extra: { kind, limit, used, requested: Number(quantity) } })
  return { kind, limit, used, remaining: limit > 0 ? Math.max(0, limit - used) : null }
}

export function assertWorkspaceRole(role, allowed = WORKSPACE_ROLES) {
  if (!allowed.includes(role)) throw Object.assign(new Error('Rol sin permisos para esta operación.'), { status: 403 })
}

export async function resolveWorkspaceContext({ userId, workspaceId, siteId, siteHandle, role } = {}) {
  const pool = await poolOrThrow()
  const params = []
  const where = []
  if (workspaceId) { params.push(text(workspaceId, 160)); where.push(`wm.workspace_id = $${params.length}`) }
  if (userId) { params.push(text(userId, 160)); where.push(`wm.user_id = $${params.length}`) }
  if (siteId) { params.push(text(siteId, 160)); where.push(`s.id = $${params.length}`) }
  if (siteHandle) { params.push(text(siteHandle, 160)); where.push(`s.handle = $${params.length}`) }
  if (role && role !== 'admin') { params.push(text(role, 40)); where.push(`wm.role = $${params.length}`) }
  const result = await pool.query(`
    SELECT wm.workspace_id AS "workspaceId", wm.user_id AS "userId", wm.role,
           w.name AS "workspaceName",
           s.id AS "siteId", s.handle, s.name AS "siteName"
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN workspace_member_sites wms ON wms.member_id = wm.id
    LEFT JOIN sites s ON s.id = wms.site_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY wm.created_at ASC
  `, params)
  if (!result.rows.length) throw Object.assign(new Error('Workspace o sitio no encontrado.'), { status: 404 })
  const first = result.rows[0]
  const sites = [...new Map(result.rows.filter((row) => row.siteId).map((row) => [row.siteId, { id: row.siteId, handle: row.handle, name: row.siteName }])).values()]
  return { workspaceId: first.workspaceId, workspaceName: first.workspaceName, userId: first.userId, role: first.role, siteIds: [...new Set(sites.map((s) => s.id))], sites }
}

export async function ensureWorkspaceSeed({ workspaceId = 'workspace-escarlet', name = 'Escarlet', slug = 'escarlet', userId = 'system', role = 'owner', sites = [] } = {}) {
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    await client.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, updated_at=NOW()', [workspaceId, name, slug])
    let memberUserId = userId
    let memberRole = role
    if (memberUserId === 'system') {
      const existingOwner = await client.query("SELECT user_id,role FROM workspace_members WHERE workspace_id=$1 AND role IN ('owner','admin') ORDER BY CASE WHEN role='owner' THEN 0 ELSE 1 END,created_at LIMIT 1", [workspaceId])
      memberUserId = existingOwner.rows[0]?.user_id || memberUserId
      memberRole = existingOwner.rows[0]?.role || memberRole
    }
    await client.query('INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=NOW()', [id(`member-${workspaceId}-${memberUserId}`), workspaceId, memberUserId, memberRole])
    for (const site of sites) {
      const siteId = id(site.id || site.handle)
      await client.query('INSERT INTO sites (id,workspace_id,handle,name,domain,created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, domain=EXCLUDED.domain, updated_at=NOW()', [siteId, workspaceId, required(site.handle, 'handle', 120), required(site.name || site.handle, 'name', 200), text(site.domain, 500) || null, memberUserId])
      const member = await client.query('SELECT id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, memberUserId])
      await client.query('INSERT INTO workspace_member_sites (member_id,site_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [member.rows[0].id, siteId])
      await client.query('INSERT INTO brand_kits (id,site_id) VALUES ($1,$2) ON CONFLICT (site_id) DO NOTHING', [`brand-${siteId}`, siteId])
      const versionId = `brand-${siteId}-version-1`
      await client.query('INSERT INTO brand_kit_versions (id,brand_kit_id,version,status,manifest,created_by) VALUES ($1,$2,1,\'published\',$3,$4) ON CONFLICT (brand_kit_id,version) DO NOTHING', [versionId, `brand-${siteId}`, '{}', memberUserId])
      await client.query('UPDATE brand_kits SET active_version_id=COALESCE(active_version_id,$1),updated_at=NOW() WHERE id=$2', [versionId, `brand-${siteId}`])
    }
    return { workspaceId }
  })
}

export async function createBrandKitVersion({ workspaceId, siteId, userId, role, manifest = {}, status = 'draft' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  if (!['draft', 'published'].includes(status)) throw Object.assign(new Error('Estado de brand kit inválido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const kit = await client.query('INSERT INTO brand_kits (id,site_id) VALUES ($1,$2) ON CONFLICT (site_id) DO UPDATE SET updated_at=NOW() RETURNING id', [`brand-${siteId}`, siteId])
    const brandKitId = kit.rows[0].id
    const next = await client.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM brand_kit_versions WHERE brand_kit_id=$1', [brandKitId])
    const version = Number(next.rows[0].version)
    const versionId = randomUUID()
    await client.query('INSERT INTO brand_kit_versions (id,brand_kit_id,version,status,manifest,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [versionId, brandKitId, version, status, JSON.stringify(jsonObject(manifest)), userId || null])
    if (status === 'published') {
      await client.query('UPDATE brand_kit_versions SET status=\'draft\' WHERE brand_kit_id=$1 AND id<>$2', [brandKitId, versionId])
      await client.query('UPDATE brand_kits SET active_version_id=$1,updated_at=NOW() WHERE id=$2', [versionId, brandKitId])
    }
    return { id: versionId, brandKitId, siteId, version, status, manifest: jsonObject(manifest) }
  })
}

export async function getActiveBrandKit({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const result = await pool.query('SELECT bkv.*,bk.site_id AS "siteId" FROM brand_kits bk LEFT JOIN brand_kit_versions bkv ON bkv.id=bk.active_version_id JOIN sites s ON s.id=bk.site_id WHERE bk.site_id=$1 AND s.workspace_id=$2', [siteId, workspaceId])
  if (!result.rowCount) throw Object.assign(new Error('Brand kit no encontrado.'), { status: 404 })
  const assets = result.rows[0].id
    ? await pool.query('SELECT id,name,storage_key AS "storageKey",public_url AS "publicUrl",content_type AS "contentType",size_bytes AS "sizeBytes",sha256,visibility,metadata FROM brand_assets WHERE brand_kit_version_id=$1 ORDER BY created_at', [result.rows[0].id])
    : { rows: [] }
  return { ...result.rows[0], assets: assets.rows }
}

export async function registerBrandAssets({ workspaceId, siteId, brandKitVersionId, userId, role, assets = [] } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  const version = await pool.query('SELECT bkv.id FROM brand_kit_versions bkv JOIN brand_kits bk ON bk.id=bkv.brand_kit_id JOIN sites s ON s.id=bk.site_id WHERE bkv.id=$1 AND s.id=$2 AND s.workspace_id=$3', [brandKitVersionId, siteId, workspaceId])
  if (!version.rowCount) throw Object.assign(new Error('La versión de brand kit no pertenece al sitio.'), { status: 403 })
  const inserted = []
  for (const asset of Array.isArray(assets) ? assets.slice(0, 100) : []) {
    const name = required(asset?.name, 'asset.name', 240)
    const storageKey = required(asset?.storageKey, 'asset.storageKey', 1000)
    const row = await pool.query('INSERT INTO brand_assets (id,brand_kit_version_id,name,storage_key,public_url,content_type,size_bytes,sha256,visibility,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET public_url=EXCLUDED.public_url,sha256=EXCLUDED.sha256,metadata=EXCLUDED.metadata RETURNING id,name,public_url AS "publicUrl",visibility', [id(`brand-asset-${brandKitVersionId}-${name}`), brandKitVersionId, name, storageKey, text(asset.publicUrl, 2000) || null, text(asset.contentType, 120) || null, Number(asset.sizeBytes) || null, text(asset.sha256, 100) || null, ['private', 'role_limited', 'public'].includes(asset.visibility) ? asset.visibility : 'private', JSON.stringify(jsonObject(asset.metadata))])
    inserted.push(row.rows[0])
  }
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.assets_registered', 'brand_kit_version', brandKitVersionId, JSON.stringify({ count: inserted.length })])
  return inserted
}

export async function createContentBatch({ workspaceId, siteId, userId, role, title, topics, channels = ['blog'], brandKitVersionId = null, metadata = {} } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor', 'author'])
  const cleanTopics = Array.isArray(topics) ? topics.map((topic) => text(topic, 500)).filter(Boolean).slice(0, 100) : []
  if (!cleanTopics.length) throw Object.assign(new Error('topics debe contener al menos un tema.'), { status: 400 })
  const cleanChannels = [...new Set((Array.isArray(channels) ? channels : []).map((channel) => text(channel, 50).toLowerCase()))].filter((channel) => CONTENT_CHANNELS.includes(channel))
  if (!cleanChannels.length) throw Object.assign(new Error('channels no contiene canales válidos.'), { status: 400 })
  const pool = await poolOrThrow()
  const batchId = randomUUID()
  return withPgTransaction(pool, async (client) => {
    const access = role === 'admin' || !userId
      ? await client.query('SELECT 1 FROM sites WHERE id=$1 AND workspace_id=$2', [siteId, workspaceId])
      : await client.query('SELECT 1 FROM sites s JOIN workspace_members wm ON wm.workspace_id=s.workspace_id JOIN workspace_member_sites wms ON wms.member_id=wm.id AND wms.site_id=s.id WHERE s.id=$1 AND s.workspace_id=$2 AND wm.user_id=$3', [siteId, workspaceId, userId])
    if (!access.rowCount) throw Object.assign(new Error('Sin acceso al sitio.'), { status: 403 })
    const configuredChannels = await client.query('SELECT channel FROM site_channels WHERE site_id=$1 AND enabled=TRUE', [siteId])
    if (configuredChannels.rowCount) {
      const enabled = new Set(configuredChannels.rows.map((row) => row.channel))
      const unavailable = cleanChannels.filter((channel) => !enabled.has(channel))
      if (unavailable.length) throw Object.assign(new Error(`Los canales no están activos para esta marca: ${unavailable.join(', ')}.`), { status: 409, code: 'channel_disabled', extra: { channels: unavailable } })
    }
    const activeKit = await client.query('SELECT active_version_id FROM brand_kits WHERE site_id=$1', [siteId])
    const effectiveBrandKitVersionId = text(brandKitVersionId, 160) || activeKit.rows[0]?.active_version_id || null
    if (effectiveBrandKitVersionId) {
      const kit = await client.query('SELECT 1 FROM brand_kit_versions bkv JOIN brand_kits bk ON bk.id=bkv.brand_kit_id JOIN sites s ON s.id=bk.site_id WHERE bkv.id=$1 AND s.id=$2 AND s.workspace_id=$3', [effectiveBrandKitVersionId, siteId, workspaceId])
      if (!kit.rowCount) throw Object.assign(new Error('La versión de brand kit no pertenece al sitio.'), { status: 403 })
    }
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId])
    const membership = await client.query('SELECT status,current_period_end AS "currentPeriodEnd" FROM subscriptions WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 1', [workspaceId])
    const grant = userId ? await client.query("SELECT 1 FROM entitlements WHERE workspace_id=$1 AND (key=$2 OR key LIKE $3) AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1", [workspaceId, `grant:${userId}`, `grant:%:${userId}`]) : { rowCount: 0 }
    if (membershipIsBlocked(membership.rows[0]) && !grant.rowCount) throw Object.assign(new Error('Membresía del workspace suspendida.'), { status: 402, code: 'MEMBERSHIP_SUSPENDED' })
    const usagePeriod = period()
    const usageCounter = await client.query('SELECT quantity FROM usage_counters WHERE workspace_id=$1 AND period=$2 AND kind=$3 FOR UPDATE', [workspaceId, usagePeriod, 'content_items_created'])
    const usageEntitlement = await client.query('SELECT value FROM entitlements WHERE workspace_id=$1 AND key IN ($2,$3) ORDER BY updated_at DESC LIMIT 1', [workspaceId, 'quota:content_items_created', 'quota'])
    const usageValue = usageEntitlement.rows[0]?.value && typeof usageEntitlement.rows[0].value === 'object' ? usageEntitlement.rows[0].value : {}
    const usageLimit = Number(usageValue.limit ?? usageValue.content_items_created ?? DEFAULT_USAGE_LIMITS.content_items_created)
    const usageUsed = Number(usageCounter.rows[0]?.quantity || 0)
    if (usageLimit > 0 && usageUsed + cleanTopics.length > usageLimit) throw Object.assign(new Error('Cuota del workspace agotada.'), { status: 429, code: 'QUOTA_EXCEEDED', extra: { kind: 'content_items_created', limit: usageLimit, used: usageUsed, requested: cleanTopics.length } })
    const generationCounter = await client.query('SELECT quantity FROM usage_counters WHERE workspace_id=$1 AND period=$2 AND kind=$3 FOR UPDATE', [workspaceId, usagePeriod, 'generations'])
    const generationEntitlement = await client.query('SELECT value FROM entitlements WHERE workspace_id=$1 AND key IN ($2,$3) ORDER BY updated_at DESC LIMIT 1', [workspaceId, 'quota:generations', 'quota'])
    const generationValue = generationEntitlement.rows[0]?.value && typeof generationEntitlement.rows[0].value === 'object' ? generationEntitlement.rows[0].value : {}
    const generationLimit = Number(generationValue.limit ?? generationValue.generations ?? DEFAULT_USAGE_LIMITS.generations)
    const generationUsed = Number(generationCounter.rows[0]?.quantity || 0)
    if (generationLimit > 0 && generationUsed + cleanTopics.length > generationLimit) throw Object.assign(new Error('Cuota de generaciones del workspace agotada.'), { status: 429, code: 'QUOTA_EXCEEDED', extra: { kind: 'generations', limit: generationLimit, used: generationUsed, requested: cleanTopics.length } })
    await client.query('INSERT INTO content_batches (id,workspace_id,site_id,created_by,title,status,brand_kit_version_id,total_items,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [batchId, workspaceId, siteId, userId || null, required(title || `Batch ${new Date().toISOString()}`, 'title', 300), 'draft', effectiveBrandKitVersionId, cleanTopics.length, JSON.stringify({ ...jsonObject(metadata), channels: cleanChannels })])
    const itemIds = []
    for (const topic of cleanTopics) {
      const itemId = randomUUID()
      itemIds.push(itemId)
      await client.query('INSERT INTO content_items (id,batch_id,workspace_id,site_id,topic,status,owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [itemId, batchId, workspaceId, siteId, topic, 'draft', userId || null])
      for (const channel of cleanChannels) await client.query('INSERT INTO content_variants (id,item_id,workspace_id,channel,status,body) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), itemId, workspaceId, channel, 'draft', JSON.stringify({ topic })])
    }
    const jobId = randomUUID()
    await client.query('INSERT INTO jobs (id,workspace_id,type,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5)', [jobId, workspaceId, 'content.generate_batch', JSON.stringify({ batchId }), `generate:${batchId}`])
    await client.query('INSERT INTO usage_events (id,workspace_id,site_id,user_id,kind,quantity,period,idempotency_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, siteId, userId || null, 'content_items_created', cleanTopics.length, usagePeriod, `batch:${batchId}`, JSON.stringify({ batchId })])
    await client.query('INSERT INTO usage_counters (workspace_id,period,kind,quantity) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,period,kind) DO UPDATE SET quantity=usage_counters.quantity+EXCLUDED.quantity,updated_at=NOW()', [workspaceId, usagePeriod, 'content_items_created', cleanTopics.length])
    await client.query('INSERT INTO usage_events (id,workspace_id,site_id,user_id,kind,quantity,period,idempotency_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, siteId, userId || null, 'generations', cleanTopics.length, usagePeriod, `generation:${batchId}`, JSON.stringify({ batchId, reserved: true })])
    await client.query('INSERT INTO usage_counters (workspace_id,period,kind,quantity) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,period,kind) DO UPDATE SET quantity=usage_counters.quantity+EXCLUDED.quantity,updated_at=NOW()', [workspaceId, usagePeriod, 'generations', cleanTopics.length])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'content.batch_created', 'content_batch', batchId, JSON.stringify({ topics: cleanTopics.length, channels: cleanChannels })])
    return { batchId, itemIds, jobId, totalItems: cleanTopics.length, channels: cleanChannels, brandKitVersionId: effectiveBrandKitVersionId }
  })
}

export async function getContentBatch({ workspaceId, batchId, siteId } = {}) {
  const pool = await poolOrThrow()
  const batch = await pool.query(`SELECT * FROM content_batches WHERE id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''}`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
  if (!batch.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
  const items = await pool.query('SELECT * FROM content_items WHERE batch_id=$1 ORDER BY created_at ASC', [batchId])
  const itemIds = items.rows.map((item) => item.id)
  const variants = itemIds.length ? await pool.query('SELECT * FROM content_variants WHERE item_id = ANY($1::text[]) ORDER BY created_at ASC', [itemIds]) : { rows: [] }
  return { ...batch.rows[0], items: items.rows.map((item) => ({ ...item, variants: variants.rows.filter((variant) => variant.item_id === item.id) })) }
}

export async function listContentItems({ workspaceId, batchId, siteId, limit = 100 } = {}) {
  const pool = await poolOrThrow()
  const params = [workspaceId]
  const where = ['ci.workspace_id=$1']
  if (batchId) { params.push(text(batchId, 160)); where.push(`ci.batch_id=$${params.length}`) }
  if (siteId) { params.push(text(siteId, 160)); where.push(`ci.site_id=$${params.length}`) }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500))
  const items = await pool.query(`SELECT ci.*, COALESCE(json_agg(cv ORDER BY cv.created_at) FILTER (WHERE cv.id IS NOT NULL), '[]') AS variants FROM content_items ci LEFT JOIN content_variants cv ON cv.item_id=ci.id WHERE ${where.join(' AND ')} GROUP BY ci.id ORDER BY ci.created_at DESC LIMIT $${params.length}`, params)
  return items.rows
}

export async function listScheduledContent({ workspaceId, siteId, from, to, limit = 300 } = {}) {
  const pool = await poolOrThrow()
  const params = [workspaceId]
  const where = ['ci.workspace_id=$1', "s.status IN ('scheduled','syncing','published','failed')"]
  if (siteId) { params.push(text(siteId, 160)); where.push(`ci.site_id=$${params.length}`) }
  if (from) {
    const date = new Date(from)
    if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('from inválido.'), { status: 400 })
    params.push(date.toISOString()); where.push(`s.publication_date >= $${params.length}`)
  }
  if (to) {
    const date = new Date(to)
    if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('to inválido.'), { status: 400 })
    params.push(date.toISOString()); where.push(`s.publication_date < $${params.length}`)
  }
  params.push(Math.min(Math.max(Number(limit) || 300, 1), 1000))
  const result = await pool.query(`
    SELECT ci.id AS "itemId",ci.batch_id AS "batchId",ci.site_id AS "siteId",ci.topic,
           cv.id AS "variantId",cv.channel,cv.status AS "variantStatus",s.publication_date AS "publicationDate",
           s.timezone,s.status,s.provider,s.provider_post_id AS "providerPostId",s.attempts,s.last_error AS "lastError"
    FROM schedules s
    JOIN content_variants cv ON cv.id=s.variant_id
    JOIN content_items ci ON ci.id=cv.item_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.publication_date ASC
    LIMIT $${params.length}
  `, params)
  return result.rows
}

// UI-facing summaries keep the PWA from rebuilding campaigns by grouping raw
// items in the browser. The technical `content_batches` name remains part of
// the API for MCP/backwards compatibility; the product calls these plans.
export async function listContentPlans({ workspaceId, siteId, limit = 50 } = {}) {
  const pool = await poolOrThrow()
  const params = [workspaceId]
  const where = ['cb.workspace_id=$1']
  if (siteId) { params.push(text(siteId, 160)); where.push(`cb.site_id=$${params.length}`) }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200))
  const result = await pool.query(`
    SELECT cb.id,cb.workspace_id,cb.site_id,cb.title,cb.status,cb.total_items,
      cb.generated_items,cb.failed_items,cb.created_at,cb.updated_at,
      COALESCE(json_agg(DISTINCT cv.channel) FILTER (WHERE cv.channel IS NOT NULL),'[]') AS channels,
      COUNT(DISTINCT ci.id)::int AS item_count,
      COUNT(DISTINCT ci.id) FILTER (WHERE ci.status IN ('generated','needs_review','approved','scheduled','syncing','published'))::int AS ready_count,
      COUNT(DISTINCT ci.id) FILTER (WHERE ci.status='failed')::int AS error_count
    FROM content_batches cb
    LEFT JOIN content_items ci ON ci.batch_id=cb.id
    LEFT JOIN content_variants cv ON cv.item_id=ci.id
    WHERE ${where.join(' AND ')}
    GROUP BY cb.id
    ORDER BY cb.created_at DESC
    LIMIT $${params.length}
  `, params)
  return result.rows.map((row) => ({
    ...row,
    totalItems: Number(row.total_items || row.item_count || 0),
    generatedItems: Number(row.generated_items || row.ready_count || 0),
    failedItems: Number(row.failed_items || row.error_count || 0),
    channels: Array.isArray(row.channels) ? row.channels.filter(Boolean) : []
  }))
}

export async function getWorkspaceFeatureFlags({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const defaults = { creation_ui_enabled: false, manual_creation_enabled: false }
  const workspace = await pool.query('SELECT key,value FROM workspace_feature_flags WHERE workspace_id=$1', [workspaceId])
  const brand = siteId ? await pool.query('SELECT key,value FROM site_feature_flags WHERE site_id=$1', [siteId]) : { rows: [] }
  const read = (rows) => Object.fromEntries(rows.map((row) => [row.key, typeof row.value === 'boolean' ? row.value : Boolean(row.value?.enabled)]))
  return { ...defaults, ...read(workspace.rows), ...read(brand.rows) }
}

export async function listSiteChannels({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const rows = await pool.query(`
    SELECT sc.channel, sc.enabled, sc.connection_status AS "connectionStatus",
           cc.provider, cc.status AS "providerStatus", cc.id AS "connectionId"
    FROM site_channels sc
    JOIN sites s ON s.id=sc.site_id
    LEFT JOIN channel_connections cc
      ON cc.site_id=sc.site_id AND cc.channel=sc.channel AND cc.is_primary=TRUE
    WHERE s.workspace_id=$1 AND sc.site_id=$2
    ORDER BY sc.channel
  `, [workspaceId, siteId])
  if (rows.rowCount) return rows.rows.map((row) => ({
    channel: row.channel,
    enabled: Boolean(row.enabled),
    connectionStatus: row.providerStatus || row.connectionStatus || 'not_connected',
    provider: row.provider || null,
    connectionId: row.connectionId || null
  }))
  // A brand created after the v2 cut starts safe: no channel is publishable
  // until an administrator explicitly enables it. Legacy installations are
  // initialized from their JSON config by initializeBrandConfiguration().
  return CHANNEL_CATALOG.map(({ id: channel }) => ({ channel, enabled: false, connectionStatus: 'not_connected', provider: null, connectionId: null }))
}

export async function initializeBrandConfiguration({ workspaceId, siteId, legacy = {} } = {}) {
  const pool = await poolOrThrow()
  const existing = await pool.query('SELECT 1 FROM site_channels WHERE site_id=$1 LIMIT 1', [siteId])
  if (existing.rowCount) return { initialized: false }
  const legacyBlog = legacy.contentMode === 'socialmedia' ? false : legacy.blogEnabled !== false
  const social = legacy.socialPackChannels && typeof legacy.socialPackChannels === 'object' ? legacy.socialPackChannels : {}
  const enabled = {
    blog: legacyBlog,
    instagram: social.instagramCarousel !== false,
    linkedin: social.linkedin !== false,
    x: social.x !== false,
    video: social.videoScript !== false,
    substack: social.substack !== false
  }
  await withPgTransaction(pool, async (client) => {
    for (const { id: channel } of CHANNEL_CATALOG) {
      await client.query('INSERT INTO site_channels (site_id,channel,enabled,connection_status) VALUES ($1,$2,$3,$4) ON CONFLICT (site_id,channel) DO NOTHING', [siteId, channel, Boolean(enabled[channel]), 'not_connected'])
    }
    const capabilityValues = {
      ...DEFAULT_BRAND_CAPABILITIES,
      content_publishing: Object.values(enabled).some(Boolean),
      blog_publishing: Boolean(enabled.blog)
    }
    for (const [key, value] of Object.entries(capabilityValues)) {
      await client.query('INSERT INTO brand_capabilities (site_id,key,enabled) VALUES ($1,$2,$3) ON CONFLICT (site_id,key) DO NOTHING', [siteId, key, value])
    }
    if (legacy.domain || legacy.rebuildWebhookUrl || legacy.coolifyApiToken) {
      await client.query(`
        INSERT INTO channel_connections (id,workspace_id,site_id,channel,provider,credentials_ciphertext,config,status,is_primary)
        VALUES ($1,$2,$3,'blog','web',$4,$5,'connected',TRUE)
        ON CONFLICT (site_id,channel,provider) DO UPDATE SET config=EXCLUDED.config,updated_at=NOW()
      `, [randomUUID(), workspaceId, siteId, legacy.coolifyApiTokenCiphertext || null, JSON.stringify({ domain: text(legacy.domain, 500) || null, rebuildWebhookUrl: text(legacy.rebuildWebhookUrl, 2000) || null })])
    }
  })
  return { initialized: true }
}

export async function listBrandCapabilities({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const rows = await pool.query('SELECT bc.key,bc.enabled,bc.config FROM brand_capabilities bc JOIN sites s ON s.id=bc.site_id WHERE s.workspace_id=$1 AND bc.site_id=$2 ORDER BY bc.key', [workspaceId, siteId])
  const values = Object.fromEntries(BRAND_CAPABILITIES.map((key) => [key, false]))
  Object.assign(values, DEFAULT_BRAND_CAPABILITIES)
  for (const row of rows.rows) values[row.key] = Boolean(row.enabled)
  return values
}

export async function setBrandCapabilities({ workspaceId, siteId, userId, role, capabilities = {} } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  const clean = Object.fromEntries(BRAND_CAPABILITIES.filter((key) => capabilities[key] !== undefined).map((key) => [key, Boolean(capabilities[key])]))
  await withPgTransaction(pool, async (client) => {
    for (const [key, enabled] of Object.entries(clean)) {
      await client.query('INSERT INTO brand_capabilities (site_id,key,enabled,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (site_id,key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW()', [siteId, key, enabled, userId || null])
    }
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.capabilities_updated', 'brand_capabilities', siteId, JSON.stringify(clean)])
  })
  return listBrandCapabilities({ workspaceId, siteId })
}

export async function updateBrandChannels({ workspaceId, siteId, userId, role, channels = {} } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  const allowed = new Set(CHANNEL_CATALOG.map(({ id }) => id))
  const clean = Object.fromEntries(Object.entries(channels).filter(([key, value]) => allowed.has(key) && typeof value === 'boolean'))
  await withPgTransaction(pool, async (client) => {
    for (const [channel, enabled] of Object.entries(clean)) {
      await client.query('INSERT INTO site_channels (site_id,channel,enabled,connection_status) VALUES ($1,$2,$3,\'not_connected\') ON CONFLICT (site_id,channel) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW()', [siteId, channel, enabled])
    }
    if (Object.prototype.hasOwnProperty.call(clean, 'blog')) {
      await client.query('INSERT INTO brand_capabilities (site_id,key,enabled,updated_by) VALUES ($1,\'blog_publishing\',$2,$3) ON CONFLICT (site_id,key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW()', [siteId, clean.blog, userId || null])
    }
    if (Object.values(clean).some(Boolean)) {
      await client.query('INSERT INTO brand_capabilities (site_id,key,enabled,updated_by) VALUES ($1,\'content_publishing\',TRUE,$2) ON CONFLICT (site_id,key) DO UPDATE SET enabled=TRUE,updated_by=EXCLUDED.updated_by,updated_at=NOW()', [siteId, userId || null])
    }
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.channels_updated', 'site_channels', siteId, JSON.stringify(clean)])
  })
  return listSiteChannels({ workspaceId, siteId })
}

export async function getBrand({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const result = await pool.query('SELECT id,workspace_id AS "workspaceId",handle,name,domain,created_at AS "createdAt",updated_at AS "updatedAt" FROM sites WHERE id=$1 AND workspace_id=$2', [siteId, workspaceId])
  if (!result.rowCount) throw Object.assign(new Error('Marca no encontrada.'), { status: 404 })
  const brand = result.rows[0]
  const [channels, capabilities, connections] = await Promise.all([
    listSiteChannels({ workspaceId, siteId }),
    listBrandCapabilities({ workspaceId, siteId }),
    listBrandConnections({ workspaceId, siteId })
  ])
  return { ...brand, channels, capabilities, connections }
}

export async function listBrands({ workspaceId } = {}) {
  const pool = await poolOrThrow()
  const rows = await pool.query('SELECT id,workspace_id AS "workspaceId",handle,name,domain,created_at AS "createdAt",updated_at AS "updatedAt" FROM sites WHERE workspace_id=$1 ORDER BY name,handle', [workspaceId])
  return Promise.all(rows.rows.map((brand) => getBrand({ workspaceId, siteId: brand.id })))
}

export async function createBrand({ workspaceId, userId, role, handle, name, domain = null } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const cleanHandle = required(handle, 'handle', 120).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!cleanHandle) throw Object.assign(new Error('El identificador de la marca no es válido.'), { status: 400 })
  const cleanName = required(name || handle, 'name', 200)
  const pool = await poolOrThrow()
  const siteId = randomUUID()
  await withPgTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT 1 FROM sites WHERE handle=$1', [cleanHandle])
    if (duplicate.rowCount) throw Object.assign(new Error('Ya existe una marca con ese identificador.'), { status: 409, code: 'brand_exists' })
    await client.query('INSERT INTO sites (id,workspace_id,handle,name,domain,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [siteId, workspaceId, cleanHandle, cleanName, text(domain, 500) || null, userId || null])
    if (userId) {
      const member = await client.query('SELECT id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role IN (\'owner\',\'admin\')', [workspaceId, userId])
      if (!member.rowCount) throw Object.assign(new Error('El usuario no es administrador de este espacio.'), { status: 403 })
      await client.query('INSERT INTO workspace_member_sites (member_id,site_id) VALUES ($1,$2)', [member.rows[0].id, siteId])
    }
    const kitId = `brand-${siteId}`
    const versionId = `brand-${siteId}-version-1`
    await client.query('INSERT INTO brand_kits (id,site_id,active_version_id) VALUES ($1,$2,$3)', [kitId, siteId, versionId])
    await client.query('INSERT INTO brand_kit_versions (id,brand_kit_id,version,status,manifest,created_by) VALUES ($1,$2,1,\'published\',$3,$4)', [versionId, kitId, '{}', userId || null])
    for (const { id: channel } of CHANNEL_CATALOG) await client.query('INSERT INTO site_channels (site_id,channel,enabled,connection_status) VALUES ($1,$2,FALSE,\'not_connected\')', [siteId, channel])
    for (const [key, enabled] of Object.entries(DEFAULT_BRAND_CAPABILITIES)) await client.query('INSERT INTO brand_capabilities (site_id,key,enabled,updated_by) VALUES ($1,$2,$3,$4)', [siteId, key, enabled, userId || null])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.created', 'brand', siteId, JSON.stringify({ handle: cleanHandle })])
  })
  return getBrand({ workspaceId, siteId })
}

export async function updateBrand({ workspaceId, siteId, userId, role, name, domain } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  const result = await pool.query('UPDATE sites SET name=COALESCE($1,name),domain=COALESCE($2,domain),updated_at=NOW() WHERE id=$3 AND workspace_id=$4 RETURNING id,workspace_id AS "workspaceId",handle,name,domain,created_at AS "createdAt",updated_at AS "updatedAt"', [name === undefined ? null : text(name, 200), domain === undefined ? null : text(domain, 500), siteId, workspaceId])
  if (!result.rowCount) throw Object.assign(new Error('Marca no encontrada.'), { status: 404 })
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.updated', 'brand', siteId, JSON.stringify({ name, domain })])
  return getBrand({ workspaceId, siteId })
}

export async function listMetricoolIntegrations({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const params = [workspaceId]
  const where = ['workspace_id=$1']
  if (siteId) { params.push(siteId); where.push(`site_id=$${params.length}`) }
  const result = await pool.query(`SELECT id,site_id AS "siteId",metricool_user_id AS "userId",blog_id AS "blogId",timezone,capabilities,enabled,updated_at AS "updatedAt",'workspace' AS channel,'metricool' AS provider FROM metricool_integrations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`, params)
  if (siteId) {
    const channels = await pool.query('SELECT id,site_id AS "siteId",external_account_id AS "userId",NULL AS "blogId",NULL AS timezone,capabilities,status AS "status",TRUE AS enabled,updated_at AS "updatedAt",channel,provider FROM channel_connections WHERE workspace_id=$1 AND site_id=$2 ORDER BY updated_at DESC', [workspaceId, siteId])
    return [...channels.rows, ...result.rows]
  }
  return result.rows
}

export async function listBrandConnections({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const result = await pool.query(`
    SELECT id,workspace_id AS "workspaceId",site_id AS "siteId",channel,provider,
           external_account_id AS "externalAccountId",config,capabilities,status,
           is_primary AS "isPrimary",last_tested_at AS "lastTestedAt",last_error AS "lastError",
           updated_at AS "updatedAt"
    FROM channel_connections
    WHERE workspace_id=$1 ${siteId ? 'AND site_id=$2' : ''}
    ORDER BY channel,provider,updated_at DESC
  `, siteId ? [workspaceId, siteId] : [workspaceId])
  return result.rows
}

export async function upsertBrandConnection({ workspaceId, siteId, userId, role, channel, provider, externalAccountId, credentialsCiphertext = null, config = {}, capabilities = {}, status = 'connected' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const normalizedChannel = required(channel, 'channel', 80).toLowerCase()
  const normalizedProvider = required(provider, 'provider', 80).toLowerCase()
  if (!CHANNEL_CATALOG.some(({ id: value }) => value === normalizedChannel)) throw Object.assign(new Error('Canal no válido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    await client.query('UPDATE channel_connections SET is_primary=FALSE,updated_at=NOW() WHERE site_id=$1 AND channel=$2 AND provider<>$3', [siteId, normalizedChannel, normalizedProvider])
    const result = await client.query(`
    INSERT INTO channel_connections (id,workspace_id,site_id,channel,provider,external_account_id,credentials_ciphertext,config,capabilities,status,is_primary,last_tested_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,NULL)
    ON CONFLICT (site_id,channel,provider) DO UPDATE SET
      external_account_id=EXCLUDED.external_account_id,
      credentials_ciphertext=COALESCE(EXCLUDED.credentials_ciphertext,channel_connections.credentials_ciphertext),
      config=EXCLUDED.config,
      capabilities=EXCLUDED.capabilities,
      status=EXCLUDED.status,
      is_primary=TRUE,
      last_error=NULL,
      updated_at=NOW()
    RETURNING id,workspace_id AS "workspaceId",site_id AS "siteId",channel,provider,external_account_id AS "externalAccountId",config,capabilities,status,is_primary AS "isPrimary",last_tested_at AS "lastTestedAt",last_error AS "lastError",updated_at AS "updatedAt"
    `, [randomUUID(), workspaceId, siteId, normalizedChannel, normalizedProvider, text(externalAccountId, 200) || null, credentialsCiphertext || null, JSON.stringify(jsonObject(config)), JSON.stringify(jsonObject(capabilities)), text(status, 40) || 'connected'])
    await client.query('UPDATE site_channels SET connection_status=$1,updated_at=NOW() WHERE site_id=$2 AND channel=$3', [text(status, 40) || 'connected', siteId, normalizedChannel])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.connection_updated', 'channel_connection', result.rows[0].id, JSON.stringify({ channel: normalizedChannel, provider: normalizedProvider })])
    return result.rows[0]
  })
}

export async function disconnectBrandConnection({ workspaceId, siteId, connectionId, userId, role } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  const result = await pool.query('UPDATE channel_connections SET status=\'disabled\',is_primary=FALSE,updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND site_id=$3 RETURNING id,channel,provider,status', [connectionId, workspaceId, siteId])
  if (!result.rowCount) throw Object.assign(new Error('Conexión no encontrada.'), { status: 404 })
  await pool.query('UPDATE site_channels SET connection_status=\'not_connected\',updated_at=NOW() WHERE site_id=$1 AND channel=$2', [siteId, result.rows[0].channel])
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, siteId, userId || null, 'brand.connection_disconnected', 'channel_connection', connectionId])
  return result.rows[0]
}

export async function listWorkspaceMembers({ workspaceId } = {}) {
  const pool = await poolOrThrow()
  const result = await pool.query(`
    SELECT wm.id,wm.user_id AS "userId",wm.role,wm.created_at AS "createdAt",wm.updated_at AS "updatedAt",
           COALESCE(json_agg(DISTINCT jsonb_build_object('id',s.id,'handle',s.handle,'name',s.name)) FILTER (WHERE s.id IS NOT NULL),'[]'::json) AS brands
    FROM workspace_members wm
    LEFT JOIN workspace_member_sites wms ON wms.member_id=wm.id
    LEFT JOIN sites s ON s.id=wms.site_id
    WHERE wm.workspace_id=$1
    GROUP BY wm.id
    ORDER BY wm.created_at ASC
  `, [workspaceId])
  return result.rows
}

export async function addWorkspaceMember({ workspaceId, userId, role = 'viewer', siteIds = [] } = {}) {
  if (!WORKSPACE_ROLES.includes(role)) throw Object.assign(new Error('Rol no válido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const memberId = id(`member-${workspaceId}-${userId}`)
    const member = await client.query('INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,updated_at=NOW() RETURNING id,workspace_id AS "workspaceId",user_id AS "userId",role', [memberId, workspaceId, userId, role])
    for (const siteId of [...new Set(siteIds.filter(Boolean))]) await client.query('INSERT INTO workspace_member_sites (member_id,site_id) SELECT $1,s.id FROM sites s WHERE s.id=$2 AND s.workspace_id=$3 ON CONFLICT DO NOTHING', [member.rows[0].id, siteId, workspaceId])
    return member.rows[0]
  })
}

export async function updateWorkspaceMember({ workspaceId, userId, role = 'viewer', siteIds } = {}) {
  if (!WORKSPACE_ROLES.includes(role)) throw Object.assign(new Error('Rol no válido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const member = await client.query('UPDATE workspace_members SET role=$1,updated_at=NOW() WHERE workspace_id=$2 AND user_id=$3 RETURNING id,workspace_id AS "workspaceId",user_id AS "userId",role', [role, workspaceId, userId])
    if (!member.rowCount) throw Object.assign(new Error('Miembro no encontrado.'), { status: 404 })
    if (Array.isArray(siteIds)) {
      await client.query('DELETE FROM workspace_member_sites WHERE member_id=$1', [member.rows[0].id])
      for (const siteId of [...new Set(siteIds.filter(Boolean))]) {
        await client.query('INSERT INTO workspace_member_sites (member_id,site_id) SELECT $1,s.id FROM sites s WHERE s.id=$2 AND s.workspace_id=$3 ON CONFLICT DO NOTHING', [member.rows[0].id, siteId, workspaceId])
      }
    }
    return member.rows[0]
  })
}

export async function setWorkspaceFeatureFlags({ workspaceId, siteId, userId, role, flags = {} } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  const allowed = ['creation_ui_enabled', 'manual_creation_enabled']
  const clean = Object.fromEntries(allowed.filter((key) => flags[key] !== undefined).map((key) => [key, Boolean(flags[key])]))
  for (const [key, value] of Object.entries(clean)) {
    if (siteId) await pool.query('INSERT INTO site_feature_flags (site_id,key,value,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (site_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()', [siteId, key, JSON.stringify(value), userId || null])
    else await pool.query('INSERT INTO workspace_feature_flags (workspace_id,key,value,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()', [workspaceId, key, JSON.stringify(value), userId || null])
  }
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,metadata) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, siteId || null, userId || null, 'feature_flags.updated', 'feature_flags', JSON.stringify(clean)])
  return getWorkspaceFeatureFlags({ workspaceId, siteId })
}

export async function updateContentItem({ workspaceId, siteId, itemId, userId, role, topic, body, channel, mediaAssetIds } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor', 'author'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const item = await client.query(`SELECT * FROM content_items WHERE id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
    if (!item.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
    if (topic !== undefined) await client.query('UPDATE content_items SET topic=$1,status=CASE WHEN status IN (\'approved\',\'scheduled\',\'published\') THEN \'needs_review\' ELSE status END,updated_at=NOW() WHERE id=$2', [required(topic, 'topic', 500), itemId])
    if (body !== undefined) {
      const cleanChannel = required(channel, 'channel', 50).toLowerCase()
      if (!CONTENT_CHANNELS.includes(cleanChannel)) throw Object.assign(new Error('Canal no válido.'), { status: 400 })
      await client.query('UPDATE content_variants SET body=$1,status=CASE WHEN status IN (\'approved\',\'scheduled\',\'published\') THEN \'needs_review\' ELSE status END,updated_at=NOW() WHERE item_id=$2 AND channel=$3', [JSON.stringify(jsonObject(body)), itemId, cleanChannel])
      if (Array.isArray(mediaAssetIds)) {
        const variant = await client.query('SELECT id FROM content_variants WHERE item_id=$1 AND channel=$2', [itemId, cleanChannel])
        if (variant.rowCount) {
          await client.query('DELETE FROM content_variant_media WHERE variant_id=$1', [variant.rows[0].id])
          for (let index = 0; index < mediaAssetIds.slice(0, 20).length; index++) {
            const assetId = text(mediaAssetIds[index], 160)
            const owned = await client.query('SELECT 1 FROM media_assets WHERE id=$1 AND workspace_id=$2 AND (site_id=$3 OR site_id IS NULL)', [assetId, workspaceId, siteId || null])
            if (owned.rowCount) await client.query('INSERT INTO content_variant_media (variant_id,media_asset_id,sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [variant.rows[0].id, assetId, index])
          }
        }
      }
    }
    await client.query('INSERT INTO audit_log (workspace_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, userId || null, 'content.item_updated', 'content_item', itemId, JSON.stringify({ topic: topic !== undefined, body: body !== undefined })])
    return (await client.query('SELECT * FROM content_items WHERE id=$1', [itemId])).rows[0]
  })
}

async function transitionVariant({ workspaceId, siteId, itemId, userId, role, action, comment = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const result = await client.query(`SELECT cv.*, ci.site_id FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteId ? 'AND ci.site_id=$3' : ''} FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
    if (!result.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
    const next = action === 'approved' ? 'approved' : 'needs_review'
    await client.query('UPDATE content_variants SET status=$1,updated_at=NOW() WHERE item_id=$2', [next, itemId])
    await client.query('UPDATE content_items SET status=$1,updated_at=NOW() WHERE id=$2', [next, itemId])
    await client.query(`UPDATE content_batches cb SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status NOT IN ('approved','scheduled','published')) THEN 'approved' WHEN EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status='needs_review') THEN 'needs_review' ELSE cb.status END,updated_at=NOW() WHERE cb.id=(SELECT batch_id FROM content_items WHERE id=$1)`, [itemId])
    await client.query('INSERT INTO approvals (id,variant_id,user_id,action,comment) SELECT $1,cv.id,$2,$3,$4 FROM content_variants cv WHERE cv.item_id=$5', [randomUUID(), userId || null, action, text(comment, 2000) || null, itemId])
    if (action === 'approved') {
      await client.query('INSERT INTO outbox_events (id,workspace_id,type,aggregate_type,aggregate_id,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, 'content.item.approved', 'content_item', itemId, JSON.stringify({ itemId }), `approve:${itemId}`])
    }
    return { itemId, status: next }
  })
}

export const approveContentItem = (args) => transitionVariant({ ...args, action: 'approved' })
export const rejectContentItem = (args) => transitionVariant({ ...args, action: 'rejected' })

export async function approveContentBatch({ workspaceId, siteId, batchId, userId, role } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  const items = await pool.query(`SELECT id FROM content_items WHERE batch_id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} ORDER BY created_at`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
  if (!items.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
  const results = []
  for (const item of items.rows) results.push(await approveContentItem({ workspaceId, siteId, itemId: item.id, userId, role }))
  return { batchId, items: results }
}

export async function rejectContentBatch({ workspaceId, siteId, batchId, userId, role, comment = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  const items = await pool.query(`SELECT id FROM content_items WHERE batch_id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} ORDER BY created_at`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
  if (!items.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
  const results = []
  for (const item of items.rows) results.push(await rejectContentItem({ workspaceId, siteId, itemId: item.id, userId, role, comment }))
  return { batchId, items: results }
}

export async function scheduleContentItem({ workspaceId, siteId, itemId, userId, role, publicationDate, timezone = 'UTC' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const date = new Date(publicationDate)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const variants = await client.query(`SELECT cv.id FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteId ? 'AND ci.site_id=$3' : ''} AND cv.status='approved' FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
    if (!variants.rowCount) throw Object.assign(new Error('El item debe estar aprobado antes de agendarlo.'), { status: 409 })
    for (const variant of variants.rows) {
      await client.query('INSERT INTO schedules (id,variant_id,publication_date,timezone,status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (variant_id) DO UPDATE SET publication_date=EXCLUDED.publication_date,timezone=EXCLUDED.timezone,status=EXCLUDED.status,updated_at=NOW()', [randomUUID(), variant.id, date.toISOString(), text(timezone, 80) || 'UTC', 'scheduled'])
      await client.query('UPDATE content_variants SET status=\'scheduled\',updated_at=NOW() WHERE id=$1', [variant.id])
    }
    await client.query('UPDATE content_items SET status=\'scheduled\',updated_at=NOW() WHERE id=$1', [itemId])
    await client.query(`UPDATE content_batches cb SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status NOT IN ('scheduled','published')) THEN 'scheduled' ELSE cb.status END,updated_at=NOW() WHERE cb.id=(SELECT batch_id FROM content_items WHERE id=$1)`, [itemId])
    await client.query('INSERT INTO outbox_events (id,workspace_id,type,aggregate_type,aggregate_id,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, 'content.item.scheduled', 'content_item', itemId, JSON.stringify({ itemId }), `schedule:${itemId}:${date.toISOString()}`])
    await client.query('INSERT INTO audit_log (workspace_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, userId || null, 'content.item_scheduled', 'content_item', itemId, JSON.stringify({ publicationDate: date.toISOString(), timezone })])
    return { itemId, status: 'scheduled', publicationDate: date.toISOString(), timezone }
  })
}

export async function scheduleContentBatch({ workspaceId, siteId, batchId, userId, role, publicationDate, timezone = 'UTC' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  const items = await pool.query(`SELECT id FROM content_items WHERE batch_id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} ORDER BY created_at`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
  if (!items.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
  const start = new Date(publicationDate)
  if (!Number.isFinite(start.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400 })
  const results = []
  for (let index = 0; index < items.rows.length; index++) {
    const date = new Date(start.getTime() + index * 60 * 60 * 1000)
    results.push(await scheduleContentItem({ workspaceId, siteId, itemId: items.rows[index].id, userId, role, publicationDate: date.toISOString(), timezone }))
  }
  return { batchId, items: results }
}

export async function cancelContentItem({ workspaceId, siteId, itemId, userId, role } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const item = await client.query(`SELECT id,batch_id,status FROM content_items WHERE id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
    if (!item.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
    if (item.rows[0].status === 'published') throw Object.assign(new Error('No se puede cancelar una publicación ya publicada.'), { status: 409 })
    await client.query("UPDATE content_items SET status='canceled',updated_at=NOW() WHERE id=$1", [itemId])
    await client.query("UPDATE content_variants SET status='canceled',updated_at=NOW() WHERE item_id=$1 AND status NOT IN ('published','canceled')", [itemId])
    await client.query("UPDATE schedules SET status='canceled',updated_at=NOW() WHERE variant_id IN (SELECT id FROM content_variants WHERE item_id=$1) AND status NOT IN ('published','canceled')", [itemId])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, siteId || null, userId || null, 'content.item_canceled', 'content_item', itemId])
    return { itemId, status: 'canceled' }
  })
}

export async function cancelContentBatch({ workspaceId, siteId, batchId, userId, role } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  const items = await pool.query(`SELECT id FROM content_items WHERE batch_id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} ORDER BY created_at`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
  if (!items.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
  const results = []
  for (const item of items.rows) {
    try { results.push(await cancelContentItem({ workspaceId, siteId, itemId: item.id, userId, role })) } catch (error) { results.push({ itemId: item.id, status: 'failed', error: error.message }) }
  }
  const canceled = results.filter((item) => item.status === 'canceled').length
  await pool.query("UPDATE content_batches SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_items WHERE batch_id=$1 AND status NOT IN ('canceled','published')) THEN 'canceled' ELSE status END,updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [batchId, workspaceId])
  return { batchId, canceled, items: results }
}

export async function recordUsage({ workspaceId, siteId, userId, kind, quantity = 1, idempotencyKey, metadata = {} } = {}) {
  const amount = Math.floor(Number(quantity))
  if (!amount || amount < 1) throw Object.assign(new Error('quantity debe ser positivo.'), { status: 400 })
  const cleanKind = required(kind, 'kind', 100)
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    if (idempotencyKey) {
      const existing = await client.query('SELECT * FROM usage_events WHERE idempotency_key=$1', [text(idempotencyKey, 300)])
      if (existing.rowCount) return existing.rows[0]
    }
    const currentPeriod = period()
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId])
    const membership = await client.query('SELECT status,current_period_end AS "currentPeriodEnd" FROM subscriptions WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 1', [workspaceId])
    const grant = userId ? await client.query("SELECT 1 FROM entitlements WHERE workspace_id=$1 AND (key=$2 OR key LIKE $3) AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1", [workspaceId, `grant:${userId}`, `grant:%:${userId}`]) : { rowCount: 0 }
    if (membershipIsBlocked(membership.rows[0]) && !grant.rowCount) throw Object.assign(new Error('Membresía del workspace suspendida.'), { status: 402, code: 'MEMBERSHIP_SUSPENDED' })
    const counter = await client.query('SELECT quantity FROM usage_counters WHERE workspace_id=$1 AND period=$2 AND kind=$3 FOR UPDATE', [workspaceId, currentPeriod, cleanKind])
    const entitlement = await client.query('SELECT value FROM entitlements WHERE workspace_id=$1 AND key IN ($2,$3) ORDER BY updated_at DESC LIMIT 1', [workspaceId, `quota:${cleanKind}`, 'quota'])
    const value = entitlement.rows[0]?.value && typeof entitlement.rows[0].value === 'object' ? entitlement.rows[0].value : {}
    const limit = Number(value.limit ?? value[cleanKind] ?? DEFAULT_USAGE_LIMITS[cleanKind] ?? 0)
    const used = Number(counter.rows[0]?.quantity || 0)
    if (limit > 0 && used + amount > limit) throw Object.assign(new Error('Cuota del workspace agotada.'), { status: 429, code: 'QUOTA_EXCEEDED', extra: { kind: cleanKind, limit, used, requested: amount } })
    const event = { id: randomUUID(), workspaceId, siteId: siteId || null, userId: userId || null, kind: cleanKind, quantity: amount, period: currentPeriod }
    await client.query('INSERT INTO usage_events (id,workspace_id,site_id,user_id,kind,quantity,period,idempotency_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [event.id, workspaceId, event.siteId, event.userId, event.kind, amount, currentPeriod, idempotencyKey ? text(idempotencyKey, 300) : null, JSON.stringify(jsonObject(metadata))])
    await client.query('INSERT INTO usage_counters (workspace_id,period,kind,quantity) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,period,kind) DO UPDATE SET quantity=usage_counters.quantity+EXCLUDED.quantity,updated_at=NOW()', [workspaceId, currentPeriod, cleanKind, amount])
    return event
  })
}

export async function usageSnapshot({ workspaceId, period: requestedPeriod = period() } = {}) {
  const pool = await poolOrThrow()
  const rows = await pool.query('SELECT kind,quantity,updated_at AS "updatedAt" FROM usage_counters WHERE workspace_id=$1 AND period=$2 ORDER BY kind', [workspaceId, text(requestedPeriod, 7)])
  const subscription = await pool.query('SELECT plan_id AS "planId",status,current_period_end AS "currentPeriodEnd" FROM subscriptions WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 1', [workspaceId])
  return { workspaceId, period: requestedPeriod, counters: Object.fromEntries(rows.rows.map((row) => [row.kind, row])), subscription: subscription.rows[0] || null }
}

export async function upsertWorkspaceSubscription({ siteHandle, subscriptionId, customerId, planId, status, currentPeriodEnd, currentPeriodStart, cancelAtPeriodEnd = false, metadata = {} } = {}) {
  const pool = await poolOrThrow()
  const site = await pool.query('SELECT workspace_id FROM sites WHERE handle=$1 LIMIT 1', [text(siteHandle, 160)])
  if (!site.rowCount) throw Object.assign(new Error('Sitio no migrado a Postgres.'), { status: 404 })
  const workspaceId = site.rows[0].workspace_id
  await pool.query(`INSERT INTO subscriptions (id,workspace_id,provider,provider_subscription_id,plan_id,status,current_period_start,current_period_end,cancel_at_period_end,metadata) VALUES ($1,$2,'stripe',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (provider_subscription_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,cancel_at_period_end=EXCLUDED.cancel_at_period_end,metadata=EXCLUDED.metadata,updated_at=NOW()`, [id(`subscription-${subscriptionId}`), workspaceId, required(subscriptionId, 'subscriptionId', 200), required(planId, 'planId', 100), required(status, 'status', 100), currentPeriodStart ? new Date(Number(currentPeriodStart) * 1000).toISOString() : null, currentPeriodEnd ? new Date(Number(currentPeriodEnd) * 1000).toISOString() : null, Boolean(cancelAtPeriodEnd), JSON.stringify({ customerId, ...jsonObject(metadata) })])
  await pool.query('INSERT INTO entitlements (id,workspace_id,key,value,source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()', [`membership-${workspaceId}`, workspaceId, 'membership', JSON.stringify({ status, planId, accessUntil: currentPeriodEnd || null }), 'stripe'])
  return { workspaceId }
}

export async function connectMetricool({ workspaceId, siteId, userId, role, userTokenCiphertext, metricoolUserId, blogId, timezone = 'UTC', capabilities = {}, channel = 'workspace' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  if (!userTokenCiphertext) throw Object.assign(new Error('userToken es obligatorio.'), { status: 400 })
  const result = await pool.query('INSERT INTO metricool_integrations (id,workspace_id,site_id,user_token_ciphertext,metricool_user_id,blog_id,timezone,capabilities) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (workspace_id,site_id) DO UPDATE SET user_token_ciphertext=EXCLUDED.user_token_ciphertext,metricool_user_id=EXCLUDED.metricool_user_id,blog_id=EXCLUDED.blog_id,timezone=EXCLUDED.timezone,capabilities=EXCLUDED.capabilities,enabled=TRUE,updated_at=NOW() RETURNING id,workspace_id,site_id,metricool_user_id,blog_id,timezone,capabilities,enabled,updated_at', [randomUUID(), workspaceId, siteId || null, userTokenCiphertext, required(metricoolUserId, 'metricoolUserId', 120), required(blogId, 'blogId', 120), text(timezone, 80) || 'UTC', JSON.stringify(jsonObject(capabilities))])
  if (siteId && CONTENT_CHANNELS.includes(text(channel, 50).toLowerCase())) {
    const normalizedChannel = text(channel, 50).toLowerCase()
    await pool.query('UPDATE channel_connections SET is_primary=FALSE,updated_at=NOW() WHERE site_id=$1 AND channel=$2', [siteId, normalizedChannel])
    await pool.query('INSERT INTO channel_connections (id,workspace_id,site_id,channel,provider,external_account_id,credentials_ciphertext,capabilities,status,is_primary,last_tested_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'connected\',TRUE,NOW()) ON CONFLICT (site_id,channel,provider) DO UPDATE SET external_account_id=EXCLUDED.external_account_id,credentials_ciphertext=EXCLUDED.credentials_ciphertext,capabilities=EXCLUDED.capabilities,status=\'connected\',is_primary=TRUE,updated_at=NOW()', [randomUUID(), workspaceId, siteId, normalizedChannel, 'metricool', required(metricoolUserId, 'metricoolUserId', 120), userTokenCiphertext, JSON.stringify(jsonObject(capabilities))])
  }
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'metricool.connected', 'metricool_integration', result.rows[0].id, JSON.stringify({ metricoolUserId: result.rows[0].metricool_user_id, blogId: result.rows[0].blog_id })])
  return result.rows[0]
}

export async function getMetricoolIntegration({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const result = await pool.query('SELECT * FROM metricool_integrations WHERE workspace_id=$1 AND (site_id=$2 OR ($2 IS NULL AND site_id IS NULL)) AND enabled=TRUE LIMIT 1', [workspaceId, siteId || null])
  if (!result.rowCount) throw Object.assign(new Error('Metricool no está conectado para este sitio.'), { status: 404 })
  return result.rows[0]
}

export async function enqueueJob({ workspaceId, type, payload = {}, idempotencyKey, availableAt = null } = {}) {
  const pool = await poolOrThrow()
  const date = availableAt ? new Date(availableAt) : null
  if (date && !Number.isFinite(date.getTime())) throw Object.assign(new Error('availableAt inválido.'), { status: 400 })
  const result = await pool.query('INSERT INTO jobs (id,workspace_id,type,payload,available_at,idempotency_key) VALUES ($1,$2,$3,$4,COALESCE($5,NOW()),$6) ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=NOW() RETURNING *', [randomUUID(), workspaceId || null, required(type, 'type', 120), JSON.stringify(jsonObject(payload)), date ? date.toISOString() : null, idempotencyKey ? text(idempotencyKey, 300) : null])
  return result.rows[0]
}

export async function claimJobs({ workerId = randomUUID(), limit = 5 } = {}) {
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const rows = await client.query(`SELECT id FROM jobs WHERE (status='queued' OR (status='running' AND locked_at < NOW() - INTERVAL '10 minutes')) AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1`, [Math.min(Math.max(Number(limit) || 5, 1), 50)])
    if (!rows.rowCount) return []
    const ids = rows.rows.map((row) => row.id)
    const claimed = await client.query('UPDATE jobs SET status=\'running\',locked_at=NOW(),locked_by=$1,attempts=attempts+1,updated_at=NOW() WHERE id=ANY($2::text[]) RETURNING *', [workerId, ids])
    return claimed.rows
  })
}

export async function finishJob(idValue, { ok, error = '', retryAt = null, deadLetter = false } = {}) {
  const pool = await poolOrThrow()
  const status = ok ? 'completed' : deadLetter ? 'dead_letter' : retryAt ? 'queued' : 'failed'
  await pool.query('UPDATE jobs SET status=$1,last_error=$2,available_at=COALESCE($3,available_at),locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$4', [status, text(error, 2000) || null, retryAt, idValue])
}

export async function claimOutbox({ workerId = randomUUID(), limit = 10 } = {}) {
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const rows = await client.query(`SELECT id FROM outbox_events WHERE (status='pending' OR (status='processing' AND locked_at < NOW() - INTERVAL '10 minutes')) AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1`, [Math.min(Math.max(Number(limit) || 10, 1), 50)])
    if (!rows.rowCount) return []
    const ids = rows.rows.map((row) => row.id)
    const claimed = await client.query('UPDATE outbox_events SET status=\'processing\',locked_at=NOW(),locked_by=$1,attempts=attempts+1 WHERE id=ANY($2::text[]) RETURNING *', [workerId, ids])
    return claimed.rows
  })
}

export async function finishOutbox(idValue, { ok, error = '', retryAt = null, deadLetter = false } = {}) {
  const pool = await poolOrThrow()
  const status = ok ? 'delivered' : deadLetter ? 'dead_letter' : retryAt ? 'pending' : 'failed'
  await pool.query('UPDATE outbox_events SET status=$1,last_error=$2,available_at=COALESCE($3,available_at),locked_at=NULL,locked_by=NULL,delivered_at=CASE WHEN $1=\'delivered\' THEN NOW() ELSE delivered_at END WHERE id=$4', [status, text(error, 2000) || null, retryAt, idValue])
}
