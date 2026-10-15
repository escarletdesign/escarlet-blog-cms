import { createHash, randomUUID } from 'node:crypto'
import { getPgPool, runCoreMigrations, withPgTransaction } from './pg.mjs'
import { blogPublicationSlug, normalizeBlogTitle } from './blog-publication.mjs'
import { assessVariant, nextVariantBody, reviewMissingVariantFields, summarizeContentListItem, validationDiagnostic } from './content-variant-state.mjs'
import { isApprovedBrandAsset } from './brand-asset-policy.mjs'
import { buildBrandOsMetadata, normalizeContentBrief } from './brand-os.mjs'

export const CONTENT_CHANNELS = Object.freeze(['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'])
export const CONTENT_STATUSES = Object.freeze(['draft', 'generated', 'needs_review', 'approved', 'scheduled', 'syncing', 'action_required', 'published', 'failed', 'canceled'])
export const WORKSPACE_ROLES = Object.freeze(['owner', 'admin', 'approver', 'editor', 'author', 'viewer'])
export const BRAND_ROLES = WORKSPACE_ROLES
const ROLE_RANK = Object.freeze({ owner: 4, admin: 3, approver: 2, editor: 2, author: 1, viewer: 0 })

export function visibleMemberRole(member, { siteId, siteHandle } = {}) {
  const workspaceRole = String(member?.role || 'viewer').toLowerCase()
  if (workspaceRole === 'owner' || workspaceRole === 'admin') return workspaceRole
  const brands = Array.isArray(member?.brands) ? member.brands : []
  const active = brands.find((brand) => (siteId && brand.id === siteId) || (siteHandle && brand.handle === siteHandle))
  if (active?.role) return String(active.role).toLowerCase()
  return brands.reduce((best, brand) => {
    const role = String(brand?.role || '').toLowerCase()
    return (ROLE_RANK[role] || 0) > (ROLE_RANK[best] || 0) ? role : best
  }, workspaceRole || 'viewer')
}
export const BRAND_CAPABILITIES = Object.freeze([
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
  { id: 'instagram', label: 'Instagram', connectionRequired: true, provider: 'buffer' },
  { id: 'instagram_story', label: 'Instagram Story', connectionRequired: true, provider: 'buffer' },
  { id: 'linkedin', label: 'LinkedIn', connectionRequired: true, provider: 'buffer' },
  { id: 'x', label: 'X', connectionRequired: true, provider: 'buffer' },
  { id: 'video', label: 'Vídeo', connectionRequired: true, provider: 'buffer' },
  { id: 'substack', label: 'Substack', connectionRequired: true, provider: 'metricool' }
])
const DEFAULT_BRAND_CAPABILITIES = Object.freeze({
  content_publishing: false,
  blog_publishing: false,
  presentation_generation: false
})

export function contentStatusFromVariantStatuses(statuses = []) {
  const values = new Set((Array.isArray(statuses) ? statuses : []).map((status) => String(status || '').toLowerCase()))
  if (values.has('action_required')) return 'action_required'
  if (values.has('failed')) return 'failed'
  if (values.has('scheduled') || values.has('syncing')) return 'scheduled'
  if (values.has('approved')) return 'approved'
  if (values.has('needs_review')) return 'needs_review'
  if (values.has('generated')) return 'generated'
  if (values.has('draft')) return 'draft'
  return values.has('published') ? 'published' : 'canceled'
}

function text(value, max = 500) { return String(value ?? '').trim().slice(0, max) }
function connectionChannel(channel) { return channel === 'instagram_story' ? 'instagram' : channel }
const BUFFER_CHANNELS = Object.freeze(['instagram', 'instagram_story', 'linkedin', 'x', 'video'])
function bufferChannelId(config = {}, channel, fallback = '') {
  const value = jsonObject(config)
  const ids = jsonObject(value.channelIds || value.channel_ids)
  const selected = ids[channel] || (channel === 'instagram_story' ? ids.instagram : channel === 'video' ? ids.video || ids.instagram : '')
  return text(selected, 300) || text(value.channelId || value.channel_id || fallback, 300)
}
function required(value, label, max = 500) {
  const out = text(value, max)
  if (!out) throw Object.assign(new Error(`${label} es obligatorio.`), { status: 400 })
  return out
}
function id(value) { return text(value, 160) || randomUUID() }
function jsonObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
async function attachVariantMedia(pool, variants = []) {
  const rows = Array.isArray(variants) ? variants : []
  const ids = rows.map((variant) => text(variant?.id, 160)).filter(Boolean)
  if (!ids.length) return rows.map((variant) => ({ ...variant, media: [] }))
  const media = await pool.query(`
    SELECT cvm.variant_id AS "variantId",cvm.sort_order AS "assetIndex",ma.id,ma.public_url AS "url",ma.storage_key AS "path",
           ma.content_type AS "contentType",ma.size_bytes AS "sizeBytes",ma.sha256,ma.metadata
    FROM content_variant_media cvm
    JOIN media_assets ma ON ma.id=cvm.media_asset_id
    WHERE cvm.variant_id=ANY($1::text[])
    ORDER BY cvm.variant_id,cvm.sort_order ASC
  `, [ids])
  const grouped = new Map()
  for (const asset of media.rows) {
    const list = grouped.get(asset.variantId) || []
    const metadata = jsonObject(asset.metadata)
    list.push({
      id: asset.id,
      assetIndex: Number(asset.assetIndex),
      url: asset.url,
      path: asset.path,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      ...Object.fromEntries(['thumbUrl', 'previewUrl', 'thumbPath', 'previewPath', 'width', 'height', 'thumbWidth', 'thumbHeight', 'previewWidth', 'previewHeight', 'originalBytes', 'storedBytes', 'thumbBytes', 'previewBytes'].filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]])),
      metadata
    })
    grouped.set(asset.variantId, list)
  }
  return rows.map((variant) => ({ ...variant, media: grouped.get(variant.id) || [] }))
}
function period(now = new Date()) { return now.toISOString().slice(0, 7) }
function dbUnavailable() { return Object.assign(new Error('Postgres no está configurado.'), { status: 503, code: 'postgres_required' }) }
async function poolOrThrow() {
  const pool = await getPgPool()
  if (!pool) throw dbUnavailable()
  if (!await runCoreMigrations()) throw Object.assign(new Error('Las migraciones de Postgres no están listas.'), { status: 503, code: 'migrations_unavailable' })
  return pool
}

// ponytail: track uncapped beta usage; add site-scoped limits before billing enforcement returns.
const USAGE_METRICS = Object.freeze(['content_items_created', 'generations', 'media_uploads', 'publications', 'external_syncs'])
const WORKER_LEASE_MS = Math.max(30_000, Number(process.env.WORKER_LEASE_MS || 10 * 60 * 1000))

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

export function assertWorkspaceRole(role, allowed = WORKSPACE_ROLES) {
  const normalized = String(role || '').toLowerCase() === 'approver' ? 'editor' : String(role || '').toLowerCase()
  if (!allowed.includes(normalized)) throw Object.assign(new Error('Rol sin permisos para esta operación.'), { status: 403 })
}

export async function resolveWorkspaceContext({ userId, workspaceId, siteId, siteHandle, role } = {}) {
  const pool = await poolOrThrow()
  const params = []
  const where = []
  if (workspaceId) { params.push(text(workspaceId, 160)); where.push(`wm.workspace_id = $${params.length}`) }
  if (userId) { params.push(text(userId, 160)); where.push(`wm.user_id = $${params.length}`) }
  if (siteId) { params.push(text(siteId, 160)); where.push(`s.id = $${params.length}`) }
  if (siteHandle) { params.push(text(siteHandle, 160)); where.push(`s.handle = $${params.length}`) }
  if (role && role !== 'admin') { params.push(text(role, 40)); where.push(`(wm.role = $${params.length} OR wms.role = $${params.length})`) }
  // Workspace owners/admins are global operators. Other roles only see the
  // brands explicitly assigned through workspace_member_sites.
  where.push("(wm.role IN ('owner','admin') OR wms.site_id IS NOT NULL)")
  const result = await pool.query(`
    SELECT wm.workspace_id AS "workspaceId", wm.user_id AS "userId", wm.role, wm.review_required AS "reviewRequired",
           COALESCE(wms.role, wm.role) AS "brandRole",
           w.name AS "workspaceName",
           s.id AS "siteId", s.handle, s.name AS "siteName"
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    JOIN sites s ON s.workspace_id = wm.workspace_id
    LEFT JOIN workspace_member_sites wms ON wms.member_id = wm.id AND wms.site_id = s.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY wm.created_at ASC
  `, params)
  if (!result.rows.length) throw Object.assign(new Error('Workspace o sitio no encontrado.'), { status: 404 })
  const first = result.rows[0]
  const sites = [...new Map(result.rows.filter((row) => row.siteId).map((row) => [row.siteId, { id: row.siteId, handle: row.handle, name: row.siteName, role: row.brandRole || row.role }])).values()]
  const selectedSite = siteId || siteHandle
  const selected = selectedSite ? sites.find((site) => site.id === siteId || site.handle === siteHandle) : sites[0]
  return {
    workspaceId: first.workspaceId,
    workspaceName: first.workspaceName,
    userId: first.userId,
    role: selected?.role || first.role,
    workspaceRole: first.role,
    brandRole: selected?.role || first.role,
    siteIds: [...new Set(sites.map((s) => s.id))],
    sites,
    brandRoles: Object.fromEntries(sites.map((site) => [site.handle, site.role])),
    reviewRequired: first.role === 'owner' ? false : first.reviewRequired !== false
  }
}

function groupBrandDirectory(rows, fallbackRole = 'viewer') {
  const workspaces = new Map()
  for (const row of rows) {
    const id = row.workspaceId
    if (!id) continue
    if (!workspaces.has(id)) workspaces.set(id, { id, name: row.workspaceName, sites: [], seen: new Set() })
    const workspace = workspaces.get(id)
    if (!row.siteId || workspace.seen.has(row.siteId)) continue
    workspace.seen.add(row.siteId)
    workspace.sites.push({
      id: row.siteId,
      handle: row.handle,
      name: row.siteName,
      role: row.brandRole || row.role || fallbackRole
    })
  }
  return [...workspaces.values()].map(({ seen, ...workspace }) => workspace)
}

export async function listBrandDirectory({ userId, workspaceId, systemAdmin = false } = {}) {
  const pool = await poolOrThrow()
  if (systemAdmin && !userId) {
    const params = []
    const where = []
    if (workspaceId) { params.push(text(workspaceId, 160)); where.push(`w.id=$${params.length}`) }
    const rows = await pool.query(`
      SELECT w.id AS "workspaceId", w.name AS "workspaceName",
             s.id AS "siteId", s.handle, s.name AS "siteName"
      FROM workspaces w
      LEFT JOIN sites s ON s.workspace_id=w.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY w.name, s.handle
    `, params)
    return groupBrandDirectory(rows.rows, 'admin')
  }
  const params = []
  const where = []
  if (workspaceId) { params.push(text(workspaceId, 160)); where.push(`wm.workspace_id=$${params.length}`) }
  if (userId) { params.push(text(userId, 160)); where.push(`wm.user_id=$${params.length}`) }
  if (!where.length) throw Object.assign(new Error('Se requiere un token personal de usuario para consultar marcas v2.'), { status: 401, code: 'user_token_required' })
  where.push("(wm.role IN ('owner','admin') OR wms.site_id IS NOT NULL)")
  const result = await pool.query(`
    SELECT wm.workspace_id AS "workspaceId", wm.role,
           COALESCE(wms.role, wm.role) AS "brandRole",
           w.name AS "workspaceName",
           s.id AS "siteId", s.handle, s.name AS "siteName"
    FROM workspace_members wm
    JOIN workspaces w ON w.id=wm.workspace_id
    JOIN sites s ON s.workspace_id=wm.workspace_id
    LEFT JOIN workspace_member_sites wms ON wms.member_id=wm.id AND wms.site_id=s.id
    WHERE ${where.join(' AND ')}
    ORDER BY w.name, s.handle
  `, params)
  if (!result.rows.length) throw Object.assign(new Error('Workspace o sitio no encontrado.'), { status: 404 })
  return groupBrandDirectory(result.rows)
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
      await client.query('INSERT INTO workspace_member_sites (member_id,site_id,role) VALUES ($1,$2,$3) ON CONFLICT (member_id,site_id) DO UPDATE SET role=EXCLUDED.role', [member.rows[0].id, siteId, memberRole])
      await client.query('INSERT INTO brand_kits (id,site_id) VALUES ($1,$2) ON CONFLICT (site_id) DO NOTHING', [`brand-${siteId}`, siteId])
      const versionId = `brand-${siteId}-version-1`
      await client.query('INSERT INTO brand_kit_versions (id,brand_kit_id,version,status,manifest,created_by) VALUES ($1,$2,1,\'published\',$3,$4) ON CONFLICT (brand_kit_id,version) DO NOTHING', [versionId, `brand-${siteId}`, '{}', memberUserId])
      await client.query('UPDATE brand_kits SET active_version_id=COALESCE(active_version_id,$1),updated_at=NOW() WHERE id=$2', [versionId, `brand-${siteId}`])
    }
    return { workspaceId }
  })
}

export async function createWorkspace({ workspaceId = randomUUID(), name, slug, userId } = {}) {
  const cleanName = required(name, 'name', 200)
  const cleanSlug = required(slug || cleanName, 'slug', 120).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!userId) throw Object.assign(new Error('userId es obligatorio.'), { status: 400 })
  const pool = await poolOrThrow()
  await withPgTransaction(pool, async (client) => {
    await client.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3)', [workspaceId, cleanName, cleanSlug])
    await client.query('INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,$4)', [id(`member-${workspaceId}-${userId}`), workspaceId, userId, 'owner'])
  })
  return { id: workspaceId, name: cleanName, slug: cleanSlug, role: 'owner' }
}

function brandKitVersionResult(row, { manifest, siteId } = {}) {
  return {
    id: row.id,
    brandKitId: row.brand_kit_id || row.brandKitId,
    siteId: siteId || row.site_id || row.siteId,
    version: Number(row.version),
    status: row.status,
    manifest: jsonObject(manifest === undefined ? row.manifest : manifest),
    baseVersionId: row.base_version_id || row.baseVersionId || null,
    snapshotHash: row.snapshot_hash || row.snapshotHash || null,
    publishedAt: row.published_at || row.publishedAt || null,
    createdAt: row.created_at || row.createdAt || null
  }
}

function brandKitManifestHash(manifest, baseVersionId) {
  return createHash('sha256').update(JSON.stringify({ manifest: jsonObject(manifest), baseVersionId: baseVersionId || null })).digest('hex')
}

async function lockedBrandKit(client, { workspaceId, siteId } = {}) {
  const site = await client.query('SELECT id FROM sites WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [siteId, workspaceId])
  if (!site.rowCount) throw Object.assign(new Error('La marca no pertenece al workspace.'), { status: 403, code: 'brand_site_forbidden' })
  await client.query('INSERT INTO brand_kits (id,site_id) VALUES ($1,$2) ON CONFLICT (site_id) DO NOTHING', [`brand-${siteId}`, siteId])
  const kit = await client.query('SELECT bk.id,bk.site_id AS "siteId",bk.active_version_id AS "activeVersionId",s.handle FROM brand_kits bk JOIN sites s ON s.id=bk.site_id WHERE bk.site_id=$1 FOR UPDATE', [siteId])
  if (!kit.rowCount) throw Object.assign(new Error('Brand kit no encontrado.'), { status: 404, code: 'brand_kit_not_found' })
  return kit.rows[0]
}

export async function createBrandKitVersion({ workspaceId, siteId, userId, role, manifest, status = 'draft', baseVersionId = null, expectedActiveVersionId = null, idempotencyKey = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  if (!['draft', 'published'].includes(status)) throw Object.assign(new Error('Estado de brand kit inválido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const kit = await lockedBrandKit(client, { workspaceId, siteId })
    const cleanIdempotencyKey = text(idempotencyKey, 300)
    if (cleanIdempotencyKey) {
      const previous = await client.query('SELECT * FROM brand_kit_versions WHERE brand_kit_id=$1 AND idempotency_key=$2', [kit.id, cleanIdempotencyKey])
      if (previous.rowCount) {
        const prior = previous.rows[0]
        if (manifest !== undefined && prior.snapshot_hash && prior.snapshot_hash !== brandKitManifestHash(jsonObject(manifest), prior.base_version_id || null)) {
          throw Object.assign(new Error('La clave de idempotencia ya fue usada para otro cambio.'), { status: 409, code: 'BRAND_KIT_IDEMPOTENCY_CONFLICT' })
        }
        return brandKitVersionResult(prior, { siteId })
      }
    }
    const activeVersionId = kit.activeVersionId || null
    if (expectedActiveVersionId !== null && text(expectedActiveVersionId, 160) !== activeVersionId) {
      throw Object.assign(new Error('El brand kit cambió desde la última lectura.'), { status: 409, code: 'BRAND_KIT_VERSION_CONFLICT', extra: { expectedActiveVersionId, activeVersionId } })
    }
    const requestedBaseVersionId = text(baseVersionId, 160) || activeVersionId
    const base = requestedBaseVersionId
      ? await client.query('SELECT id,manifest,version FROM brand_kit_versions WHERE id=$1 AND brand_kit_id=$2', [requestedBaseVersionId, kit.id])
      : { rowCount: 0, rows: [] }
    if (requestedBaseVersionId && !base.rowCount) throw Object.assign(new Error('La versión base no pertenece al brand kit.'), { status: 409, code: 'BRAND_KIT_BASE_VERSION_NOT_FOUND' })
    const resolvedManifest = manifest === undefined ? jsonObject(base.rows[0]?.manifest) : jsonObject(manifest)
    const snapshotHash = brandKitManifestHash(resolvedManifest, requestedBaseVersionId)
    const next = await client.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM brand_kit_versions WHERE brand_kit_id=$1', [kit.id])
    const version = Number(next.rows[0].version)
    const versionId = randomUUID()
    const inserted = await client.query('INSERT INTO brand_kit_versions (id,brand_kit_id,version,status,manifest,created_by,base_version_id,snapshot_hash,idempotency_key,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $4=\'published\' THEN NOW() ELSE NULL END) RETURNING *', [versionId, kit.id, version, status, JSON.stringify(resolvedManifest), userId || null, requestedBaseVersionId || null, snapshotHash, cleanIdempotencyKey || null])
    if (status === 'published') {
      await client.query('UPDATE brand_kits SET active_version_id=$1,updated_at=NOW() WHERE id=$2', [versionId, kit.id])
    }
    if (base.rows[0]?.id) {
      const assets = await client.query('SELECT name,storage_key AS "storageKey",public_url AS "publicUrl",content_type AS "contentType",size_bytes AS "sizeBytes",sha256,visibility,metadata FROM brand_assets WHERE brand_kit_version_id=$1 ORDER BY created_at', [base.rows[0].id])
      for (const asset of assets.rows) {
        if (!isApprovedBrandAsset(kit.handle, asset.name)) continue
        await client.query('INSERT INTO brand_assets (id,brand_kit_version_id,name,storage_key,public_url,content_type,size_bytes,sha256,visibility,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [randomUUID(), versionId, asset.name, asset.storageKey, asset.publicUrl, asset.contentType, asset.sizeBytes, asset.sha256, asset.visibility, JSON.stringify(jsonObject(asset.metadata))])
      }
    }
    return brandKitVersionResult(inserted.rows[0], { siteId })
  })
}

export async function publishBrandKitVersion({ workspaceId, siteId, userId, role, versionId, expectedActiveVersionId = null, idempotencyKey = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const cleanVersionId = required(versionId, 'versionId', 160)
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const kit = await lockedBrandKit(client, { workspaceId, siteId })
    const cleanIdempotencyKey = text(idempotencyKey, 300)
    if (cleanIdempotencyKey) {
      const replay = await client.query('SELECT response FROM mutation_idempotency WHERE workspace_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE', [workspaceId, 'brand_kit_publish', cleanIdempotencyKey])
      if (replay.rowCount) return replay.rows[0].response
    }
    if (expectedActiveVersionId !== null && text(expectedActiveVersionId, 160) !== (kit.activeVersionId || null)) {
      throw Object.assign(new Error('El brand kit cambió desde la última lectura.'), { status: 409, code: 'BRAND_KIT_VERSION_CONFLICT', extra: { expectedActiveVersionId, activeVersionId: kit.activeVersionId || null } })
    }
    const version = await client.query('SELECT * FROM brand_kit_versions WHERE id=$1 AND brand_kit_id=$2 FOR UPDATE', [cleanVersionId, kit.id])
    if (!version.rowCount) throw Object.assign(new Error('La versión de brand kit no pertenece al sitio.'), { status: 404, code: 'BRAND_KIT_VERSION_NOT_FOUND' })
    const row = version.rows[0]
    if (row.status === 'published') {
      if (kit.activeVersionId !== row.id) throw Object.assign(new Error('La versión publicada ya no es la activa.'), { status: 409, code: 'BRAND_KIT_VERSION_CONFLICT' })
      return brandKitVersionResult(row, { siteId })
    }
    const published = await client.query('UPDATE brand_kit_versions SET status=\'published\',published_at=COALESCE(published_at,NOW()),updated_at=NOW() WHERE id=$1 RETURNING *', [row.id])
    await client.query('UPDATE brand_kits SET active_version_id=$1,updated_at=NOW() WHERE id=$2', [row.id, kit.id])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.version_published', 'brand_kit_version', row.id, JSON.stringify({ version: row.version, idempotencyKey: cleanIdempotencyKey || null })])
    const result = brandKitVersionResult(published.rows[0], { siteId })
    if (cleanIdempotencyKey) await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [workspaceId, 'brand_kit_publish', cleanIdempotencyKey, JSON.stringify(result)])
    return result
  })
}

export async function publishBrandKitFile({ workspaceId, siteId, userId, role, file, content, expectedActiveVersionId = null, idempotencyKey = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const name = required(file, 'file', 120)
  const active = await getActiveBrandKit({ workspaceId, siteId })
  let value = content
  if (name.endsWith('.json')) {
    try { value = JSON.parse(content) } catch { value = content }
  }
  const manifest = { ...jsonObject(active.manifest), [name]: value }
  const draft = await createBrandKitVersion({
    workspaceId,
    siteId,
    userId,
    role,
    manifest,
    status: 'draft',
    baseVersionId: active.id,
    expectedActiveVersionId: expectedActiveVersionId === null ? active.id : expectedActiveVersionId,
    idempotencyKey
  })
  const published = await publishBrandKitVersion({ workspaceId, siteId, userId, role, versionId: draft.id, expectedActiveVersionId: active.id, idempotencyKey })
  return { ...published, copiedAssets: Array.isArray(active.assets) ? active.assets.length : 0 }
}

export async function getActiveBrandKit({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const result = await pool.query('SELECT bkv.*,bk.site_id AS "siteId",s.handle FROM brand_kits bk LEFT JOIN brand_kit_versions bkv ON bkv.id=bk.active_version_id JOIN sites s ON s.id=bk.site_id WHERE bk.site_id=$1 AND s.workspace_id=$2', [siteId, workspaceId])
  if (!result.rowCount) throw Object.assign(new Error('Brand kit no encontrado.'), { status: 404 })
  const assets = result.rows[0].id
    ? await pool.query('SELECT id,name,storage_key AS "storageKey",public_url AS "publicUrl",content_type AS "contentType",size_bytes AS "sizeBytes",sha256,visibility,metadata FROM brand_assets WHERE brand_kit_version_id=$1 ORDER BY created_at', [result.rows[0].id])
    : { rows: [] }
  return { ...result.rows[0], assets: assets.rows.filter((asset) => isApprovedBrandAsset(result.rows[0].handle, asset.name)) }
}

export async function cleanupBrandKitAssets({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const active = await pool.query('SELECT bkv.id,s.handle FROM brand_kits bk JOIN brand_kit_versions bkv ON bkv.id=bk.active_version_id JOIN sites s ON s.id=bk.site_id WHERE bk.site_id=$1 AND s.workspace_id=$2', [siteId, workspaceId])
  if (!active.rowCount) throw Object.assign(new Error('Brand kit no encontrado.'), { status: 404 })
  const assets = await pool.query('SELECT id,name FROM brand_assets WHERE brand_kit_version_id=$1 ORDER BY created_at', [active.rows[0].id])
  const stale = assets.rows.filter((asset) => !isApprovedBrandAsset(active.rows[0].handle, asset.name))
  if (stale.length) await pool.query('DELETE FROM brand_assets WHERE brand_kit_version_id=$1 AND id=ANY($2::text[])', [active.rows[0].id, stale.map((asset) => asset.id)])
  return { ok: true, site: active.rows[0].handle, removedBrandAssets: stale.length, keptBrandAssets: assets.rows.length - stale.length }
}

export async function getBrandKitVersion({ workspaceId, siteId, versionId } = {}) {
  const cleanVersionId = required(versionId, 'versionId', 160)
  const pool = await poolOrThrow()
  const result = await pool.query('SELECT bkv.*,bk.site_id AS "siteId",bk.active_version_id AS "activeVersionId",s.handle FROM brand_kit_versions bkv JOIN brand_kits bk ON bk.id=bkv.brand_kit_id JOIN sites s ON s.id=bk.site_id WHERE bkv.id=$1 AND s.id=$2 AND s.workspace_id=$3', [cleanVersionId, siteId, workspaceId])
  if (!result.rowCount) throw Object.assign(new Error('La versión de brand kit no pertenece al sitio.'), { status: 404, code: 'BRAND_KIT_VERSION_NOT_FOUND' })
  const assets = await pool.query('SELECT id,name,storage_key AS "storageKey",public_url AS "publicUrl",content_type AS "contentType",size_bytes AS "sizeBytes",sha256,visibility,metadata FROM brand_assets WHERE brand_kit_version_id=$1 ORDER BY created_at', [cleanVersionId])
  return { ...result.rows[0], assets: assets.rows.filter((asset) => isApprovedBrandAsset(result.rows[0].handle, asset.name)) }
}

export async function validateBrandKitVersion({ workspaceId, siteId, versionId } = {}) {
  const version = await getBrandKitVersion({ workspaceId, siteId, versionId })
  const errors = []
  if (!version.manifest || typeof version.manifest !== 'object' || Array.isArray(version.manifest)) errors.push({ code: 'manifest_invalid', message: 'El manifest debe ser un objeto JSON.' })
  const names = new Set()
  for (const asset of version.assets || []) {
    if (names.has(asset.name)) errors.push({ code: 'duplicate_asset_name', asset: asset.name, message: `El asset ${asset.name} está duplicado.` })
    names.add(asset.name)
    if (!asset.storageKey) errors.push({ code: 'asset_storage_key_required', asset: asset.name, message: `El asset ${asset.name} no tiene storageKey.` })
  }
  return { valid: errors.length === 0, versionId: version.id, status: version.status, errors, assetCount: version.assets.length }
}

export async function updateBrandAsset({ workspaceId, siteId, userId, role, assetId, alt, usage, characterId, expectedActiveVersionId = null, idempotencyKey = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const allowedUsages = new Set(['logo', 'reference', 'style_board', 'character', 'typography', 'palette', 'campaign'])
  const metadata = {}
  if (alt !== undefined) metadata.alt = text(alt, 1000)
  if (usage !== undefined) {
    const cleanUsage = text(usage, 80)
    if (!allowedUsages.has(cleanUsage)) throw Object.assign(new Error('Uso de asset no válido.'), { status: 400, code: 'invalid_brand_asset_usage' })
    metadata.usage = cleanUsage
  }
  if (characterId !== undefined) metadata.characterId = text(characterId, 160)
  if (!Object.keys(metadata).length) throw Object.assign(new Error('No hay cambios para guardar.'), { status: 400 })
  const active = await getActiveBrandKit({ workspaceId, siteId })
  if (expectedActiveVersionId !== null && text(expectedActiveVersionId, 160) !== String(active.id || '')) {
    throw Object.assign(new Error('El brand kit cambió desde la última lectura.'), { status: 409, code: 'BRAND_KIT_VERSION_CONFLICT' })
  }
  const source = (active.assets || []).find((asset) => String(asset.id) === String(assetId))
  if (!source) throw Object.assign(new Error('Asset del brand kit no encontrado.'), { status: 404, code: 'brand_asset_not_found' })
  const draft = await createBrandKitVersion({
    workspaceId,
    siteId,
    userId,
    role,
    manifest: active.manifest,
    status: 'draft',
    baseVersionId: active.id,
    expectedActiveVersionId: active.id,
    idempotencyKey
  })
  if (draft.status === 'published') {
    const replayed = await getActiveBrandKit({ workspaceId, siteId })
    return replayed.assets.find((asset) => asset.name === source.name) || source
  }
  await registerBrandAssets({
    workspaceId,
    siteId,
    brandKitVersionId: draft.id,
    userId,
    role,
    assets: [{
      name: source.name,
      storageKey: source.storageKey,
      publicUrl: source.publicUrl,
      contentType: source.contentType,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
      visibility: source.visibility,
      metadata: { ...jsonObject(source.metadata), ...metadata }
    }]
  })
  await publishBrandKitVersion({ workspaceId, siteId, userId, role, versionId: draft.id, expectedActiveVersionId: active.id, idempotencyKey })
  const updated = await getActiveBrandKit({ workspaceId, siteId })
  const result = updated.assets.find((asset) => asset.name === source.name)
  const pool = await poolOrThrow()
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.asset_updated', 'brand_asset', result?.id || assetId, JSON.stringify({ ...metadata, brandKitVersionId: updated.id })])
  return result || { ...source, metadata: { ...jsonObject(source.metadata), ...metadata } }
}

export async function removeBrandAsset({ workspaceId, siteId, userId, role, assetId, expectedActiveVersionId = null, idempotencyKey = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const active = await getActiveBrandKit({ workspaceId, siteId })
  const source = (active.assets || []).find((asset) => String(asset.id) === String(assetId))
  if (!source) throw Object.assign(new Error('Asset del brand kit no encontrado.'), { status: 404, code: 'brand_asset_not_found' })
  const draft = await createBrandKitVersion({
    workspaceId,
    siteId,
    userId,
    role,
    manifest: active.manifest,
    status: 'draft',
    baseVersionId: active.id,
    expectedActiveVersionId: expectedActiveVersionId === null ? active.id : expectedActiveVersionId,
    idempotencyKey
  })
  const pool = await poolOrThrow()
  await pool.query('DELETE FROM brand_assets WHERE brand_kit_version_id=$1 AND name=$2', [draft.id, source.name])
  await publishBrandKitVersion({ workspaceId, siteId, userId, role, versionId: draft.id, expectedActiveVersionId: active.id, idempotencyKey })
  const updated = await getActiveBrandKit({ workspaceId, siteId })
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.asset_removed', 'brand_asset', assetId, JSON.stringify({ name: source.name, brandKitVersionId: updated.id })])
  return { removed: true, assetId, name: source.name, brandKitVersionId: updated.id }
}

export async function registerBrandAssets({ workspaceId, siteId, brandKitVersionId, userId, role, assets = [] } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const version = await client.query('SELECT bkv.id,bkv.status,s.handle FROM brand_kit_versions bkv JOIN brand_kits bk ON bk.id=bkv.brand_kit_id JOIN sites s ON s.id=bk.site_id WHERE bkv.id=$1 AND s.id=$2 AND s.workspace_id=$3 FOR UPDATE', [brandKitVersionId, siteId, workspaceId])
    if (!version.rowCount) throw Object.assign(new Error('La versión de brand kit no pertenece al sitio.'), { status: 403 })
    if (version.rows[0].status === 'published') throw Object.assign(new Error('Las versiones publicadas son inmutables. Crea un draft para cambiar sus assets.'), { status: 409, code: 'BRAND_KIT_VERSION_IMMUTABLE' })
    const inserted = []
    for (const asset of Array.isArray(assets) ? assets.slice(0, 100) : []) {
      const name = required(asset?.name, 'asset.name', 240)
      if (!isApprovedBrandAsset(version.rows[0].handle, name)) {
        throw Object.assign(new Error(`El asset ${name} no está aprobado para el brand kit de Escarlet.`), { status: 400, code: 'BRAND_ASSET_NOT_APPROVED' })
      }
      const storageKey = required(asset?.storageKey, 'asset.storageKey', 1000)
      const values = [storageKey, text(asset.publicUrl, 2000) || null, text(asset.contentType, 120) || null, Number(asset.sizeBytes) || null, text(asset.sha256, 100) || null, ['private', 'role_limited', 'public'].includes(asset.visibility) ? asset.visibility : 'private', JSON.stringify(jsonObject(asset.metadata))]
      const existing = await client.query('SELECT id FROM brand_assets WHERE brand_kit_version_id=$1 AND name=$2 FOR UPDATE', [brandKitVersionId, name])
      const row = existing.rowCount
        ? await client.query('UPDATE brand_assets SET storage_key=$1,public_url=$2,content_type=$3,size_bytes=$4,sha256=$5,visibility=$6,metadata=$7,created_at=COALESCE(created_at,NOW()) WHERE id=$8 RETURNING id,name,public_url AS "publicUrl",visibility', [...values, existing.rows[0].id])
        : await client.query('INSERT INTO brand_assets (id,brand_kit_version_id,name,storage_key,public_url,content_type,size_bytes,sha256,visibility,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,name,public_url AS "publicUrl",visibility', [id(`brand-asset-${brandKitVersionId}-${name}`), brandKitVersionId, name, ...values])
      inserted.push(row.rows[0])
    }
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.assets_registered', 'brand_kit_version', brandKitVersionId, JSON.stringify({ count: inserted.length, status: version.rows[0].status })])
    return inserted
  })
}

export async function registerContentMedia({ workspaceId, siteId, userId, role, media, brandGrounding = null, idempotencyKey = '', idempotencyFingerprint = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor', 'author'])
  const assetId = required(media?.id, 'media.id', 160)
  const storageKey = required(media?.path || media?.url, 'media.path', 1000).replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '')
  const pool = await poolOrThrow()
  const site = await pool.query('SELECT 1 FROM sites WHERE id=$1 AND workspace_id=$2', [siteId, workspaceId])
  if (!site.rowCount) throw Object.assign(new Error('La marca no pertenece al workspace.'), { status: 403 })
  const metadata = {
    ...(media.metadata && typeof media.metadata === 'object' && !Array.isArray(media.metadata) ? media.metadata : {}),
    filename: text(media.filename, 300),
    alt: text(media.alt, 1000),
    kind: text(media.kind, 40),
    optimized: Boolean(media.optimized),
    metadataSanitized: Boolean(media.metadataSanitized),
    ...(media.width ? { width: Number(media.width) } : {}),
    ...(media.height ? { height: Number(media.height) } : {}),
    ...(media.originalDimensions ? { originalDimensions: jsonObject(media.originalDimensions) } : {}),
    ...(media.normalizedDimensions ? { normalizedDimensions: jsonObject(media.normalizedDimensions) } : {}),
    ...(media.autoNormalized !== undefined ? { autoNormalized: Boolean(media.autoNormalized) } : {}),
    ...(media.originalBytes ? { originalBytes: Number(media.originalBytes) } : {}),
    ...(media.storedBytes ? { storedBytes: Number(media.storedBytes) } : {}),
    ...(media.thumbBytes ? { thumbBytes: Number(media.thumbBytes) } : {}),
    ...(media.previewBytes ? { previewBytes: Number(media.previewBytes) } : {}),
    ...(media.thumbWidth ? { thumbWidth: Number(media.thumbWidth) } : {}),
    ...(media.thumbHeight ? { thumbHeight: Number(media.thumbHeight) } : {}),
    ...(media.previewWidth ? { previewWidth: Number(media.previewWidth) } : {}),
    ...(media.previewHeight ? { previewHeight: Number(media.previewHeight) } : {}),
    ...(media.thumbUrl || media.thumbPath ? { thumbUrl: media.thumbUrl || media.thumbPath, thumbPath: media.thumbPath || media.thumbUrl } : {}),
    ...(media.previewUrl || media.previewPath ? { previewUrl: media.previewUrl || media.previewPath, previewPath: media.previewPath || media.previewUrl } : {}),
    provenanceVersion: text(media.provenanceVersion || brandGrounding?.provenanceVersion || 'legacy', 20),
    ...(brandGrounding ? { brandGrounding } : {})
  }
  return withPgTransaction(pool, async (client) => {
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId])
    const cleanIdempotencyKey = text(idempotencyKey, 300)
    const scope = `content_upload_media:${siteId}`
    if (cleanIdempotencyKey) {
      const previous = await client.query('SELECT response FROM mutation_idempotency WHERE workspace_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE', [workspaceId, scope, cleanIdempotencyKey])
      if (previous.rowCount) {
        const stored = jsonObject(previous.rows[0].response)
        if (stored.fingerprint !== idempotencyFingerprint) throw Object.assign(new Error('La idempotencyKey ya se usó con datos distintos.'), { status: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' })
        return { ...jsonObject(stored.asset), idempotentReplay: true }
      }
    }
    const grounding = jsonObject(brandGrounding)
    const preparationId = text(grounding.brandPreparationId || grounding.preparationId, 200)
    const groundedIndex = Number(grounding.assetIndex)
    const groundedItemId = text(grounding.itemId, 160)
    const sha256 = text(media.sha256, 100)
    const channels = [...new Set((Array.isArray(grounding.channels) ? grounding.channels : []).map((value) => text(value, 50).toLowerCase()).filter(Boolean))]
    if (preparationId && groundedItemId && sha256 && Number.isInteger(groundedIndex)) {
      const existing = await client.query(`
        SELECT id,workspace_id AS "workspaceId",site_id AS "siteId",storage_key AS "storageKey",public_url AS "publicUrl",content_type AS "contentType",size_bytes AS "sizeBytes",sha256,metadata,created_at AS "createdAt"
        FROM media_assets
        WHERE workspace_id=$1 AND site_id=$2 AND sha256=$3
          AND COALESCE(metadata->'brandGrounding'->>'brandPreparationId', metadata->'brandGrounding'->>'preparationId')=$4
          AND metadata->'brandGrounding'->>'assetIndex'=$5
          AND metadata->'brandGrounding'->>'itemId'=$6
          AND (
            cardinality($7::text[])=0
            OR COALESCE(metadata->'brandGrounding'->'channels', '[]'::jsonb) ?| $7::text[]
          )
        ORDER BY created_at ASC
        LIMIT 1
      `, [workspaceId, siteId, sha256, preparationId, String(groundedIndex), groundedItemId, channels])
      if (existing.rowCount) {
        if (cleanIdempotencyKey) await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id, scope, idempotency_key) DO NOTHING', [workspaceId, scope, cleanIdempotencyKey, JSON.stringify({ fingerprint: idempotencyFingerprint, asset: existing.rows[0] })])
        console.info(JSON.stringify({ event: 'content_media_reused', itemId: groundedItemId, assetIndex: groundedIndex, preparationId, channels, mediaAssetId: existing.rows[0].id }))
        return { ...existing.rows[0], idempotentReplay: true }
      }
    }
    const result = await client.query(`
      INSERT INTO media_assets (id,workspace_id,site_id,storage_key,public_url,content_type,size_bytes,sha256,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET public_url=EXCLUDED.public_url,content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,metadata=EXCLUDED.metadata
      RETURNING id,workspace_id AS "workspaceId",site_id AS "siteId",storage_key AS "storageKey",public_url AS "publicUrl",content_type AS "contentType",size_bytes AS "sizeBytes",sha256,metadata,created_at AS "createdAt"
    `, [assetId, workspaceId, siteId, storageKey, text(media.publicUrl || media.url, 2000) || null, text(media.mimeType || media.contentType, 120) || null, Number(media.storedBytes || media.sizeBytes) || null, text(media.sha256, 100) || null, JSON.stringify(metadata)])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'content.media_uploaded', 'media_asset', assetId, JSON.stringify({ kind: metadata.kind, brandGrounded: Boolean(brandGrounding) })])
    if (cleanIdempotencyKey) await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [workspaceId, scope, cleanIdempotencyKey, JSON.stringify({ fingerprint: idempotencyFingerprint, asset: result.rows[0] })])
    return result.rows[0]
  })
}

export async function preflightContentMediaAttachment({ workspaceId, siteId, itemId, channels = [], assetIndex = 0 } = {}) {
  const cleanChannels = [...new Set((Array.isArray(channels) ? channels : []).map((value) => text(value, 50).toLowerCase()))]
  const sortOrder = Number(assetIndex)
  if (!cleanChannels.length || cleanChannels.some((channel) => !CONTENT_CHANNELS.includes(channel))) throw Object.assign(new Error('channels debe incluir canales válidos para asociar el medio.'), { status: 400, code: 'MEDIA_CHANNELS_REQUIRED' })
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 19) throw Object.assign(new Error('assetIndex debe estar entre 0 y 19.'), { status: 400, code: 'ASSET_INDEX_INVALID' })
  const pool = await poolOrThrow()
  const item = await pool.query('SELECT id FROM content_items WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [text(itemId, 160), workspaceId, siteId])
  if (!item.rowCount) throw Object.assign(new Error('Item no encontrado para esta marca.'), { status: 404, code: 'CONTENT_ITEM_NOT_FOUND' })
  const variants = await pool.query('SELECT channel,body FROM content_variants WHERE item_id=$1 AND workspace_id=$2 AND channel=ANY($3::text[])', [itemId, workspaceId, cleanChannels])
  const found = new Set(variants.rows.map((row) => row.channel))
  const missing = cleanChannels.filter((channel) => !found.has(channel))
  if (missing.length) throw Object.assign(new Error(`El item no tiene variantes para ${missing.join(', ')}.`), { status: 409, code: 'CONTENT_VARIANT_REQUIRED', extra: { channels: missing } })
  const instagram = variants.rows.find((variant) => variant.channel === 'instagram')
  const storyVariant = variants.rows.find((variant) => variant.channel === 'instagram_story')
  const slides = jsonObject(jsonObject(instagram?.body).socialPack).instagramSlides
  const storyFrames = jsonObject(jsonObject(storyVariant?.body).socialPack).instagramStory?.frames
  const slide = Array.isArray(slides) ? slides[sortOrder] : null
  const frame = Array.isArray(storyFrames) ? storyFrames[sortOrder] : null
  const source = cleanChannels.includes('instagram_story') ? frame : slide
  const textContent = jsonObject(source?.textContent)
  const headline = String(textContent.headline || source?.headline || '').trim()
  const body = String(textContent.body || source?.body || source?.text || '').trim()
  const socialTextContent = headline && body ? { headline, body } : null
  return { itemId, channels: cleanChannels, assetIndex: sortOrder, valid: true, socialTextContent }
}

function assertContentMediaAttachable(metadata, channels = []) {
  const meta = jsonObject(metadata)
  const kind = text(meta.kind, 40).toLowerCase()
  if (kind === 'reference') {
    throw Object.assign(new Error('kind=reference es moodboard del kit y no se asocia a variantes blog/social.'), {
      status: 409,
      code: 'REFERENCE_NOT_ATTACHABLE'
    })
  }
  const contentChannels = (Array.isArray(channels) ? channels : []).map((value) => text(value, 50).toLowerCase()).filter((value) => ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'substack'].includes(value))
  if (!contentChannels.length) return
  const grounding = jsonObject(meta.brandGrounding)
  const preparationId = text(grounding.brandPreparationId || grounding.preparationId, 200)
  if (!preparationId) {
    throw Object.assign(new Error('El medio necesita brandPreparationId (prepare/style board) para asociarse a contenido.'), {
      status: 409,
      code: 'BRAND_PREPARATION_REQUIRED'
    })
  }
}

export async function attachContentMedia({ workspaceId, siteId, itemId, userId, role, mediaAssetId, channels = [], assetIndex = 0, createMissingVariants = [], removeReplacedAssets = false } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor', 'author'])
  const cleanChannels = [...new Set((Array.isArray(channels) ? channels : []).map((value) => text(value, 50).toLowerCase()))]
  if (!cleanChannels.length || cleanChannels.some((value) => !CONTENT_CHANNELS.includes(value))) throw Object.assign(new Error('channels no contiene canales válidos.'), { status: 400 })
  const sortOrder = Number(assetIndex)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 19) throw Object.assign(new Error('assetIndex debe estar entre 0 y 19.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const item = await client.query('SELECT id,batch_id AS "batchId" FROM content_items WHERE id=$1 AND workspace_id=$2 AND site_id=$3 FOR UPDATE', [itemId, workspaceId, siteId])
    if (!item.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
    const asset = await client.query('SELECT id,metadata FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [mediaAssetId, workspaceId, siteId])
    if (!asset.rowCount) throw Object.assign(new Error('El medio no pertenece a esta marca.'), { status: 404, code: 'MEDIA_ASSET_NOT_FOUND' })
    assertContentMediaAttachable(asset.rows[0].metadata, cleanChannels)
    await client.query("UPDATE media_assets SET metadata = metadata - 'contentCopyStale' - 'contentCopyStaleAt' WHERE id=$1", [mediaAssetId])
    const variants = await client.query('SELECT id,channel,body FROM content_variants WHERE item_id=$1 AND workspace_id=$2 AND channel=ANY($3::text[])', [itemId, workspaceId, cleanChannels])
    const found = new Set(variants.rows.map((row) => row.channel))
    const missing = cleanChannels.filter((value) => !found.has(value))
    const createChannels = [...new Set((Array.isArray(createMissingVariants) ? createMissingVariants : []).map((value) => text(value, 50).toLowerCase()))]
    const unhandled = missing.filter((value) => !createChannels.includes(value))
    if (unhandled.length) throw Object.assign(new Error(`El item no tiene variante para ${unhandled.join(', ')}.`), { status: 409, code: 'CONTENT_VARIANT_REQUIRED' })
    for (const channel of missing.filter((value) => createChannels.includes(value))) {
      await client.query('INSERT INTO content_variants (id,item_id,workspace_id,channel,status,body) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (item_id,channel) DO NOTHING', [randomUUID(), itemId, workspaceId, channel, 'draft', JSON.stringify({})])
    }
    const attachedVariants = missing.length
      ? await client.query('SELECT id,channel,body FROM content_variants WHERE item_id=$1 AND workspace_id=$2 AND channel=ANY($3::text[])', [itemId, workspaceId, cleanChannels])
      : variants
    const replacedAssets = new Map()
    for (const variant of attachedVariants.rows) {
      if (removeReplacedAssets) {
        const previous = await client.query(`
          SELECT ma.id,ma.storage_key AS "storageKey",ma.public_url AS "publicUrl"
          FROM content_variant_media cvm
          JOIN media_assets ma ON ma.id=cvm.media_asset_id
          WHERE cvm.variant_id=$1 AND cvm.sort_order=$2 AND cvm.media_asset_id<>$3
        `, [variant.id, sortOrder, mediaAssetId])
        for (const row of previous.rows) replacedAssets.set(row.id, row)
      }
      await client.query('DELETE FROM content_variant_media WHERE variant_id=$1 AND sort_order=$2', [variant.id, sortOrder])
      await client.query('INSERT INTO content_variant_media (variant_id,media_asset_id,sort_order) VALUES ($1,$2,$3) ON CONFLICT (variant_id,media_asset_id) DO UPDATE SET sort_order=EXCLUDED.sort_order', [variant.id, mediaAssetId, sortOrder])
    }
    const removedMedia = []
    for (const previous of replacedAssets.values()) {
      const referenced = await client.query('SELECT 1 FROM content_variant_media WHERE media_asset_id=$1 LIMIT 1', [previous.id])
      if (referenced.rowCount) continue
      const removed = await client.query('DELETE FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3 RETURNING id,storage_key AS "storageKey",public_url AS "publicUrl"', [previous.id, workspaceId, siteId])
      if (removed.rowCount) removedMedia.push(removed.rows[0])
    }
    const assetMetadata = jsonObject(asset.rows[0].metadata)
    const alt = text(assetMetadata.alt, 1000)
    for (const variant of attachedVariants.rows) {
      const body = jsonObject(variant.body)
      const nextBody = withVariantMediaAlt(body, variant.channel, assetMetadata, sortOrder, alt)
      await client.query('UPDATE content_variants SET body=$1,updated_at=NOW() WHERE id=$2', [JSON.stringify(nextBody), variant.id])
    }
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'content.media_attached', 'media_asset', mediaAssetId, JSON.stringify({ itemId, channels: cleanChannels, assetIndex: sortOrder })])
    const readiness = await contentItemReadiness(client, itemId)
    if (readiness.complete) await markContentReady(client, itemId, readiness)
    return { itemId, batchId: item.rows[0].batchId, mediaAssetId, channels: cleanChannels, assetIndex: sortOrder, removedMedia, contentComplete: readiness.complete, incomplete: readiness.incomplete, status: readiness.complete ? 'generated' : 'draft' }
  })
}

/**
 * Returns the system campaign used for Posts that are not assigned to a
 * user-facing campaign. Keeping the foreign key populated means the current
 * relational model stays safe while the product exposes campaigns as optional.
 */
export async function getOrCreateInboxCampaign({ workspaceId, siteId, userId = null } = {}) {
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const existing = await client.query(`
      SELECT id,title,status,brand_kit_version_id AS "brandKitVersionId",metadata
      FROM content_batches
      WHERE workspace_id=$1 AND site_id=$2 AND metadata->>'system'='inbox'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
    `, [workspaceId, siteId])
    if (existing.rowCount) return existing.rows[0]
    const brandKit = await client.query('SELECT active_version_id FROM brand_kits WHERE site_id=$1', [siteId])
    const batch = {
      id: randomUUID(),
      title: 'Inbox editorial',
      status: 'draft',
      brandKitVersionId: brandKit.rows[0]?.active_version_id || null,
      metadata: { system: 'inbox', hiddenFromCampaignList: true }
    }
    await client.query(`
      INSERT INTO content_batches (id,workspace_id,site_id,created_by,title,status,brand_kit_version_id,total_items,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)
    `, [batch.id, workspaceId, siteId, userId, batch.title, batch.status, batch.brandKitVersionId, JSON.stringify(batch.metadata)])
    return batch
  })
}

function withVariantMediaAlt(body, channel, mediaMetadata, index, alt) {
  const assetType = text(jsonObject(mediaMetadata.brandGrounding).assetType || mediaMetadata.assetType, 80)
  if (channel === 'instagram_story' || assetType === 'instagram_story') {
    const pack = jsonObject(body.socialPack)
    const story = jsonObject(pack.instagramStory)
    const frames = Array.isArray(story.frames) ? [...story.frames] : []
    while (frames.length <= index) frames.push({})
    frames[index] = { ...jsonObject(frames[index]), alt }
    return { ...body, socialPack: { ...pack, instagramStory: { ...story, frames } } }
  }
  if (channel === 'instagram') {
    const pack = jsonObject(body.socialPack)
    const slides = Array.isArray(pack.instagramSlides) ? [...pack.instagramSlides] : []
    while (slides.length <= index) slides.push({})
    slides[index] = { ...jsonObject(slides[index]), alt }
    return { ...body, socialPack: { ...pack, instagramSlides: slides } }
  }
  return { ...body, imageAlt: alt }
}

export function contentTitleFromBrief(value) {
  return normalizeBlogTitle(text(value, 500)) || 'Nueva publicación'
}

function normalizeContentItems({ topics, items }) {
  const source = Array.isArray(items) && items.length ? items : (Array.isArray(topics) ? topics : [])
  return source.map((entry) => {
    const variants = typeof entry === 'string' ? {} : jsonObject(entry?.variants)
    const brief = text(typeof entry === 'string' ? entry : entry?.brief || entry?.topic || entry?.description || entry?.title || variants.blog?.title, 500)
    const title = contentTitleFromBrief(typeof entry === 'string' ? brief : entry?.title || brief)
    return { title, brief, variants }
  }).filter((entry) => entry.brief).slice(0, 100)
}

export async function createContentBatch({ workspaceId, siteId, userId, role, title, topics, items, batchId: requestedBatchId = null, channels, brandKitVersionId = null, metadata = {}, idempotencyKey = '', quotaExempt = false, inbox = false } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor', 'author'])
  const cleanItems = normalizeContentItems({ topics, items })
  if (!cleanItems.length) throw Object.assign(new Error('topics o items debe contener al menos una publicación.'), { status: 400 })
  const pool = await poolOrThrow()
  const inboxBatch = inbox && !requestedBatchId
    ? await getOrCreateInboxCampaign({ workspaceId, siteId, userId })
    : null
  const effectiveRequestedBatchId = requestedBatchId || inboxBatch?.id || null
  const newBatchId = randomUUID()
  return withPgTransaction(pool, async (client) => {
    const access = role === 'admin' || !userId
      ? await client.query('SELECT 1 FROM sites WHERE id=$1 AND workspace_id=$2', [siteId, workspaceId])
      : await client.query('SELECT 1 FROM sites s JOIN workspace_members wm ON wm.workspace_id=s.workspace_id JOIN workspace_member_sites wms ON wms.member_id=wm.id AND wms.site_id=s.id WHERE s.id=$1 AND s.workspace_id=$2 AND wm.user_id=$3', [siteId, workspaceId, userId])
    if (!access.rowCount) throw Object.assign(new Error('Sin acceso al sitio.'), { status: 403 })
    // Serializa mutaciones del workspace para que dos reintentos concurrentes
    // de la misma clave de idempotencia vean la respuesta ya persistida.
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId])
    const cleanIdempotencyKey = text(idempotencyKey, 300)
    if (cleanIdempotencyKey) {
      const previous = await client.query('SELECT response FROM mutation_idempotency WHERE workspace_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE', [workspaceId, 'content_create_batch', cleanIdempotencyKey])
      if (previous.rowCount) return previous.rows[0].response
    }
    const existing = effectiveRequestedBatchId ? await client.query('SELECT id,title,status,brand_kit_version_id,metadata FROM content_batches WHERE id=$1 AND workspace_id=$2 AND site_id=$3 FOR UPDATE', [text(effectiveRequestedBatchId, 160), workspaceId, siteId]) : { rowCount: 0, rows: [] }
    if (effectiveRequestedBatchId && !existing.rowCount) throw Object.assign(new Error('La campaña solicitada no existe para esta marca.'), { status: 404, code: 'CONTENT_PLAN_NOT_FOUND' })
    if (existing.rows[0] && ['published', 'canceled'].includes(existing.rows[0].status)) throw Object.assign(new Error('No se pueden añadir publicaciones a una campaña cerrada.'), { status: 409, code: 'CONTENT_PLAN_NOT_ACTIVE' })
    const existingMetadata = jsonObject(existing.rows[0]?.metadata)
    const variantChannels = cleanItems.flatMap((entry) => Object.keys(entry.variants || {}))
    const requestedChannels = Array.isArray(channels) && channels.length ? channels : variantChannels.length ? variantChannels : existingMetadata.channels
    const cleanChannels = [...new Set((Array.isArray(requestedChannels) ? requestedChannels : ['blog']).map((channel) => text(channel, 50).toLowerCase()))].filter((channel) => CONTENT_CHANNELS.includes(channel))
    if (!cleanChannels.length) throw Object.assign(new Error('channels no contiene canales válidos.'), { status: 400 })
    const configuredChannels = await client.query('SELECT channel FROM site_channels WHERE site_id=$1 AND enabled=TRUE', [siteId])
    if (configuredChannels.rowCount) {
      const enabled = new Set(configuredChannels.rows.map((row) => row.channel))
      const unavailable = cleanChannels.filter((channel) => !enabled.has(channel))
      if (unavailable.length) throw Object.assign(new Error(`Los canales no están activos para esta marca: ${unavailable.join(', ')}.`), { status: 409, code: 'channel_disabled', extra: { channels: unavailable } })
    }
    const activeKit = await client.query(`SELECT bk.active_version_id,bkv.version,bkv.snapshot_hash,bkv.manifest
      FROM brand_kits bk LEFT JOIN brand_kit_versions bkv ON bkv.id=bk.active_version_id WHERE bk.site_id=$1`, [siteId])
    const effectiveBrandKitVersionId = text(brandKitVersionId, 160) || existing.rows[0]?.brand_kit_version_id || activeKit.rows[0]?.active_version_id || null
    if (effectiveBrandKitVersionId) {
      const kit = await client.query('SELECT 1 FROM brand_kit_versions bkv JOIN brand_kits bk ON bk.id=bkv.brand_kit_id JOIN sites s ON s.id=bk.site_id WHERE bkv.id=$1 AND s.id=$2 AND s.workspace_id=$3', [effectiveBrandKitVersionId, siteId, workspaceId])
      if (!kit.rowCount) throw Object.assign(new Error('La versión de brand kit no pertenece al sitio.'), { status: 403 })
    }
    const brandVersion = effectiveBrandKitVersionId
      ? (await client.query('SELECT bkv.version,bkv.snapshot_hash,bkv.manifest,s.handle FROM brand_kit_versions bkv JOIN brand_kits bk ON bk.id=bkv.brand_kit_id JOIN sites s ON s.id=bk.site_id WHERE bkv.id=$1', [effectiveBrandKitVersionId])).rows[0]
      : activeKit.rows[0]
    const membership = await client.query('SELECT status,current_period_end AS "currentPeriodEnd" FROM subscriptions WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 1', [workspaceId])
    const grant = userId ? await client.query("SELECT 1 FROM entitlements WHERE workspace_id=$1 AND (key=$2 OR key LIKE $3) AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1", [workspaceId, `grant:${userId}`, `grant:%:${userId}`]) : { rowCount: 0 }
    if (membershipIsBlocked(membership.rows[0]) && !grant.rowCount) throw Object.assign(new Error('Membresía del workspace suspendida.'), { status: 402, code: 'MEMBERSHIP_SUSPENDED' })
    const usagePeriod = period()
    const batchId = existing.rows[0]?.id || newBatchId
    const planTitle = existing.rows[0]?.title || required(title || cleanItems[0]?.title || `Campaña ${new Date().toISOString()}`, 'title', 300)
    const brief = normalizeContentBrief(metadata?.contentBrief || metadata?.brief)
    const brandOs = buildBrandOsMetadata({
      site: brandVersion?.handle || siteId,
      brandKitVersionId: effectiveBrandKitVersionId,
      brandKitVersion: brandVersion?.version,
      brandKitSnapshotHash: brandVersion?.snapshot_hash,
      manifest: brandVersion?.manifest,
      brief,
      variants: Object.fromEntries(cleanItems.flatMap((entry) => Object.entries(entry.variants || {})))
    })
    const batchMetadata = { ...jsonObject(metadata), channels: cleanChannels, brandOs }
    if (!existing.rows[0]) await client.query('INSERT INTO content_batches (id,workspace_id,site_id,created_by,title,status,brand_kit_version_id,total_items,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [batchId, workspaceId, siteId, userId || null, planTitle, 'draft', effectiveBrandKitVersionId, cleanItems.length, JSON.stringify(batchMetadata)])
    const itemIds = []
    const variantIds = {}
    for (const entry of cleanItems) {
      const itemId = randomUUID()
      itemIds.push(itemId)
      variantIds[itemId] = {}
      const itemBrandOs = buildBrandOsMetadata({
        site: brandVersion?.handle || siteId,
        brandKitVersionId: effectiveBrandKitVersionId,
        brandKitVersion: brandVersion?.version,
        brandKitSnapshotHash: brandVersion?.snapshot_hash,
        manifest: brandVersion?.manifest,
        brief,
        variants: entry.variants
      })
      await client.query('INSERT INTO content_items (id,batch_id,workspace_id,site_id,topic,status,owner_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [itemId, batchId, workspaceId, siteId, entry.brief, 'draft', userId || null, JSON.stringify({ contentTitle: entry.title, brandOs: itemBrandOs })])
      for (const channel of cleanChannels) {
        const variantId = randomUUID()
        variantIds[itemId][channel] = variantId
        await client.query('INSERT INTO content_variants (id,item_id,workspace_id,channel,status,body) VALUES ($1,$2,$3,$4,$5,$6)', [variantId, itemId, workspaceId, channel, 'draft', JSON.stringify(jsonObject(entry.variants?.[channel]))])
      }
    }
    if (existing.rows[0]) await client.query('UPDATE content_batches SET total_items=(SELECT COUNT(*) FROM content_items WHERE batch_id=$1),updated_at=NOW() WHERE id=$1', [batchId])
    const usageInsert = await client.query('INSERT INTO usage_events (id,workspace_id,site_id,user_id,kind,quantity,period,idempotency_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id', [randomUUID(), workspaceId, siteId, userId || null, 'content_items_created', cleanItems.length, usagePeriod, `batch:${batchId}:${cleanIdempotencyKey || randomUUID()}`, JSON.stringify({ batchId })])
    if (usageInsert.rowCount) await client.query('INSERT INTO usage_counters (workspace_id,period,kind,quantity) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,period,kind) DO UPDATE SET quantity=usage_counters.quantity+EXCLUDED.quantity,updated_at=NOW()', [workspaceId, usagePeriod, 'content_items_created', cleanItems.length])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, existing.rows[0] ? 'content.items_added' : 'content.batch_created', existing.rows[0] ? 'content_batch' : 'content_batch', batchId, JSON.stringify({ items: cleanItems.length, channels: cleanChannels })])
    const response = { batchId, itemIds, variantIds, status: 'draft', totalItems: cleanItems.length, channels: cleanChannels, brandKitVersionId: effectiveBrandKitVersionId, planTitle, brandOs, appendedToExisting: Boolean(existing.rows[0]) }
    if (cleanIdempotencyKey) await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [workspaceId, 'content_create_batch', cleanIdempotencyKey, JSON.stringify(response)])
    return response
  })
}

export async function getContentBatch({ workspaceId, batchId, siteId } = {}) {
  const pool = await poolOrThrow()
  const batch = await pool.query(`SELECT * FROM content_batches WHERE id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''}`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
  if (!batch.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
  const items = await pool.query('SELECT * FROM content_items WHERE batch_id=$1 ORDER BY created_at ASC', [batchId])
  const itemIds = items.rows.map((item) => item.id)
  const variants = itemIds.length ? await pool.query('SELECT cv.*, s.publication_date AS "publicationDate", s.timezone AS "scheduleTimezone", s.status AS "scheduleStatus", s.last_error AS "lastError" FROM content_variants cv LEFT JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id = ANY($1::text[]) ORDER BY cv.created_at ASC', [itemIds]) : { rows: [] }
  const hydratedVariants = await attachVariantMedia(pool, variants.rows)
  return { ...batch.rows[0], items: items.rows.map((item) => ({ ...item, variants: hydratedVariants.filter((variant) => variant.item_id === item.id).map(annotateVariant) })) }
}

export async function getContentItem({ workspaceId, itemId, siteId } = {}) {
  const pool = await poolOrThrow()
  const params = siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId]
  const item = await pool.query(`SELECT ci.*,cb.title AS "planTitle",cb.metadata AS "campaignMetadata" FROM content_items ci JOIN content_batches cb ON cb.id=ci.batch_id WHERE ci.id=$1 AND ci.workspace_id=$2 ${siteId ? 'AND ci.site_id=$3' : ''}`, params)
  if (!item.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
  const variants = await pool.query('SELECT cv.*, s.publication_date AS "publicationDate", s.timezone AS "scheduleTimezone", s.status AS "scheduleStatus", s.last_error AS "lastError" FROM content_variants cv LEFT JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 ORDER BY cv.created_at ASC', [itemId])
  const hydrated = await attachVariantMedia(pool, variants.rows)
  return { ...item.rows[0], variants: hydrated.map(annotateVariant) }
}

function annotateVariant(variant) {
  const { state, fields } = assessVariant(variant)
  return {
    ...variant,
    readiness: {
      complete: fields.length === 0,
      expectedAssetCount: state.expectedAssetCount,
      mediaCount: state.mediaCount,
      mediaAssetIndexes: state.assetIndexes,
      bodySlidesCount: state.bodySlides.length,
      instagramSlidesCount: state.instagramSlides.length,
      storyFramesCount: state.frames.length,
      missingFields: fields
    }
  }
}

function contentItemFilters({ workspaceId, batchId, siteId, status, channel, query, archive = 'active', limit = 100, inbox, max = 500 } = {}) {
  const params = [workspaceId]
  const where = ['ci.workspace_id=$1']
  if (archive === 'archived') where.push(`COALESCE(ci.metadata->>'archivedAt','')<>''`)
  else if (archive !== 'all') where.push(`COALESCE(ci.metadata->>'archivedAt','')=''`)
  if (inbox === true) where.push(`COALESCE(cb.metadata->>'system','')='inbox'`)
  else if (inbox === false) where.push(`COALESCE(cb.metadata->>'system','')<>'inbox'`)
  if (batchId) { params.push(text(batchId, 160)); where.push(`ci.batch_id=$${params.length}`) }
  if (siteId) { params.push(text(siteId, 160)); where.push(`ci.site_id=$${params.length}`) }
  const statuses = (Array.isArray(status) ? status : status ? [status] : [])
    .map((value) => text(value, 40))
    .filter((value) => value !== 'all')
    .filter(Boolean)
  if (statuses.length === 1) {
    params.push(statuses[0])
    where.push(`ci.status=$${params.length}`)
  } else if (statuses.length > 1) {
    params.push(statuses)
    where.push(`ci.status = ANY($${params.length}::text[])`)
  }
  if (channel && text(channel, 40) !== 'all') {
    params.push(text(channel, 40))
    where.push(`EXISTS (SELECT 1 FROM content_variants cv_filter WHERE cv_filter.item_id=ci.id AND cv_filter.channel=$${params.length})`)
  }
  if (query) {
    params.push(`%${text(query, 200)}%`)
    where.push(`(ci.topic ILIKE $${params.length} OR cb.title ILIKE $${params.length})`)
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), max))
  return { params, where }
}

function contentArchiveMetadata(metadata, { archived, userId, at = new Date().toISOString() } = {}) {
  const next = { ...jsonObject(metadata) }
  if (archived) {
    next.archivedAt = at
    if (userId) next.archivedBy = text(userId, 160)
  } else {
    delete next.archivedAt
    delete next.archivedBy
  }
  return next
}

export { contentArchiveMetadata }

export async function listContentItems({ workspaceId, batchId, siteId, status, channel, query, archive = 'active', limit = 100, offset = 0, inbox } = {}) {
  const pool = await poolOrThrow()
  const { params, where } = contentItemFilters({ workspaceId, batchId, siteId, status, channel, query, archive, limit, inbox })
  const limitParam = params.length
  const cleanOffset = Math.max(Number.parseInt(offset, 10) || 0, 0)
  params.push(cleanOffset)
  const items = await pool.query(`
    SELECT ci.*, cb.title AS "planTitle", cb.status AS "planStatus",
           s.handle AS "siteHandle", s.name AS "siteName",
           COALESCE(json_agg(cv ORDER BY cv.created_at) FILTER (WHERE cv.id IS NOT NULL), '[]') AS variants
    FROM content_items ci
    JOIN content_batches cb ON cb.id=ci.batch_id
    JOIN sites s ON s.id=ci.site_id
    LEFT JOIN content_variants cv ON cv.item_id=ci.id
    WHERE ${where.join(' AND ')}
    GROUP BY ci.id, cb.id, s.id
    ORDER BY ci.created_at DESC
    LIMIT $${limitParam} OFFSET $${params.length}
  `, params)
  const variantIds = items.rows.flatMap((item) => (Array.isArray(item.variants) ? item.variants : []).map((variant) => variant.id).filter(Boolean))
  const schedules = variantIds.length ? await pool.query('SELECT variant_id AS "variantId",publication_date AS "publicationDate",timezone AS "scheduleTimezone",status AS "scheduleStatus",last_error AS "lastError" FROM schedules WHERE variant_id=ANY($1::text[])', [variantIds]) : { rows: [] }
  const scheduleByVariant = new Map(schedules.rows.map((schedule) => [schedule.variantId, schedule]))
  const hydrated = await Promise.all(items.rows.map(async (item) => ({
    ...item,
    variants: await attachVariantMedia(pool, (Array.isArray(item.variants) ? item.variants : []).map((variant) => ({ ...variant, ...(scheduleByVariant.get(variant.id) || {}) })))
  })))
  return hydrated
}

export async function listContentItemSummaries({ workspaceId, batchId, siteId, status, channel, query, archive = 'active', limit = 100, offset = 0, inbox } = {}) {
  const pool = await poolOrThrow()
  const { params, where } = contentItemFilters({ workspaceId, batchId, siteId, status, channel, query, archive, limit, inbox })
  const limitParam = params.length
  const cleanOffset = Math.max(Number.parseInt(offset, 10) || 0, 0)
  params.push(cleanOffset)
  const items = await pool.query(`
    SELECT ci.id, ci.batch_id AS "batchId", ci.topic, ci.status, ci.metadata,
           ci.created_at AS "createdAt", ci.updated_at AS "updatedAt",
           COALESCE(json_agg(json_build_object(
             'channel', cv.channel,
             'status', cv.status,
             'mediaCount', (SELECT COUNT(*)::int FROM content_variant_media cvm WHERE cvm.variant_id=cv.id)
           ) ORDER BY cv.created_at) FILTER (WHERE cv.id IS NOT NULL), '[]') AS variants
    FROM content_items ci
    JOIN content_batches cb ON cb.id=ci.batch_id
    JOIN sites s ON s.id=ci.site_id
    LEFT JOIN content_variants cv ON cv.item_id=ci.id
    WHERE ${where.join(' AND ')}
    GROUP BY ci.id
    ORDER BY ci.created_at DESC
    LIMIT $${limitParam} OFFSET $${params.length}
  `, params)
  return items.rows.map(summarizeContentListItem)
}

export async function archiveContentItem({ workspaceId, siteId, itemId, userId, role, archived = true, idempotencyKey = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const cleanIdempotencyKey = text(idempotencyKey, 300)
    if (cleanIdempotencyKey) {
      const replay = await client.query('SELECT response FROM mutation_idempotency WHERE workspace_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE', [workspaceId, 'content_post_archive', cleanIdempotencyKey])
      if (replay.rowCount) return replay.rows[0].response
    }
    const result = await client.query(`SELECT id,status,metadata FROM content_items WHERE id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
    if (!result.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
    if (archived && result.rows[0].status === 'published') throw Object.assign(new Error('Un Post publicado no se archiva porque ya tiene una publicación completada.'), { code: 'post_archive_completed', status: 409 })
    if (archived) {
      const completed = await client.query("SELECT 1 FROM content_variants cv LEFT JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND (cv.status='published' OR s.status='published') LIMIT 1", [itemId])
      if (completed.rowCount) throw Object.assign(new Error('Una variante publicada no se puede archivar desde el auditor.'), { code: 'post_archive_completed', status: 409 })
    }
    const metadata = contentArchiveMetadata(result.rows[0].metadata, { archived, userId })
    await client.query('UPDATE content_items SET metadata=$1,updated_at=NOW() WHERE id=$2', [JSON.stringify(metadata), itemId])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, archived ? 'content.item_archived' : 'content.item_restored', 'content_item', itemId, JSON.stringify({ archived })])
    const response = { itemId, archived, archivedAt: metadata.archivedAt || null }
    if (cleanIdempotencyKey) await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [workspaceId, 'content_post_archive', cleanIdempotencyKey, JSON.stringify(response)])
    return response
  })
}

export async function listScheduledContent({ workspaceId, siteId, from, to, limit = 300 } = {}) {
  const pool = await poolOrThrow()
  const params = [workspaceId]
  const where = ['ci.workspace_id=$1', "s.status IN ('scheduled','syncing','published','failed','action_required')", "COALESCE(ci.metadata->>'archivedAt','')=''"]
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
    SELECT ci.id AS "itemId",ci.batch_id AS "batchId",cb.title AS "planTitle",ci.site_id AS "siteId",ci.topic,
           cv.id AS "variantId",cv.channel,cv.status AS "variantStatus",s.publication_date AS "publicationDate",
           s.timezone,s.status,s.provider,s.provider_post_id AS "providerPostId",s.attempts,s.last_error AS "lastError",s.updated_at AS "updatedAt"
    FROM schedules s
    JOIN content_variants cv ON cv.id=s.variant_id
    JOIN content_items ci ON ci.id=cv.item_id
    LEFT JOIN content_batches cb ON cb.id=ci.batch_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.publication_date ASC
    LIMIT $${params.length}
  `, params)
  return result.rows
}

// UI-facing summaries keep the PWA from rebuilding campaigns by grouping raw
// items in the browser. The technical `content_batches` name is the canonical
// storage model; the product calls these records campaigns.
export async function listContentPlans({ workspaceId, siteId, status, channel, query, limit = 50 } = {}) {
  const pool = await poolOrThrow()
  const params = [workspaceId]
  const where = ["cb.workspace_id=$1", "COALESCE(cb.metadata->>'system','') <> 'inbox'"]
  if (siteId) { params.push(text(siteId, 160)); where.push(`cb.site_id=$${params.length}`) }
  const statuses = (Array.isArray(status) ? status : status ? [status] : [])
    .map((value) => text(value, 40))
    .filter((value) => value !== 'all')
    .filter(Boolean)
  if (statuses.length === 1) {
    params.push(statuses[0])
    where.push(`cb.status=$${params.length}`)
  } else if (statuses.length > 1) {
    params.push(statuses)
    where.push(`cb.status = ANY($${params.length}::text[])`)
  }
  if (channel && text(channel, 40) !== 'all') {
    params.push(text(channel, 40))
    where.push(`EXISTS (SELECT 1 FROM content_variants cv_filter JOIN content_items ci_filter ON ci_filter.id=cv_filter.item_id WHERE ci_filter.batch_id=cb.id AND cv_filter.channel=$${params.length})`)
  }
  if (query) {
    params.push(`%${text(query, 200)}%`)
    where.push(`cb.title ILIKE $${params.length}`)
  }
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
  const defaults = { creation_ui_enabled: true, manual_creation_enabled: false, content_review_enabled: true }
  const workspace = await pool.query('SELECT key,value FROM workspace_feature_flags WHERE workspace_id=$1', [workspaceId])
  const brand = siteId ? await pool.query('SELECT key,value FROM site_feature_flags WHERE site_id=$1', [siteId]) : { rows: [] }
  const read = (rows) => Object.fromEntries(rows.map((row) => [row.key, typeof row.value === 'boolean' ? row.value : Boolean(row.value?.enabled)]))
  return { ...defaults, ...read(workspace.rows), ...read(brand.rows) }
}

export async function listSiteChannels({ workspaceId, siteId } = {}) {
  const pool = await poolOrThrow()
  const rows = await pool.query(`
    SELECT sc.channel, sc.enabled, sc.connection_status AS "connectionStatus",
           cc.provider, cc.status AS "providerStatus", cc.id AS "connectionId", cc.config
    FROM site_channels sc
    JOIN sites s ON s.id=sc.site_id
    LEFT JOIN LATERAL (
      SELECT provider,status,id,config
      FROM channel_connections
      WHERE site_id=sc.site_id
        AND is_primary=TRUE
        AND (
          channel=CASE WHEN sc.channel='instagram_story' THEN 'instagram' ELSE sc.channel END
          OR (provider='buffer' AND channel='buffer')
        )
      ORDER BY CASE WHEN channel=CASE WHEN sc.channel='instagram_story' THEN 'instagram' ELSE sc.channel END THEN 0 ELSE 1 END,
               updated_at DESC
      LIMIT 1
    ) cc ON TRUE
    WHERE s.workspace_id=$1 AND sc.site_id=$2
    ORDER BY sc.channel
  `, [workspaceId, siteId])
  if (rows.rowCount) return rows.rows.map((row) => {
    const config = jsonObject(row.config)
    const providerStatus = text(row.providerStatus, 40).toLowerCase()
    const provider = row.provider || null
    let connectionStatus = row.connectionStatus || 'not_connected'
    if (providerStatus === 'connected' && provider === 'buffer') {
      connectionStatus = resolveBufferChannelId(config, row.channel) ? 'connected' : 'not_connected'
    } else if (providerStatus) {
      connectionStatus = providerStatus
    }
    return {
      channel: row.channel,
      enabled: Boolean(row.enabled),
      connectionStatus,
      provider,
      connectionId: row.connectionId || null
    }
  })
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
    instagram_story: social.instagramStory !== false,
    linkedin: social.linkedin !== false,
    x: social.x !== false,
    video: social.videoScript !== false,
    substack: false
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
  for (const row of rows.rows) {
    if (BRAND_CAPABILITIES.includes(row.key)) values[row.key] = Boolean(row.enabled)
  }
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
  const clean = Object.fromEntries(Object.entries(channels).filter(([key, value]) => key !== 'substack' && allowed.has(key) && typeof value === 'boolean'))
  await withPgTransaction(pool, async (client) => {
    await client.query("UPDATE site_channels SET enabled=FALSE,updated_at=NOW() WHERE site_id=$1 AND channel='substack'", [siteId])
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

export async function createBrand({ workspaceId, userId, role, handle, name, domain = null, systemAdmin = false } = {}) {
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
    if (userId && !systemAdmin) {
      const member = await client.query('SELECT id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role IN (\'owner\',\'admin\')', [workspaceId, userId])
      if (!member.rowCount) throw Object.assign(new Error('El usuario no es administrador de este espacio.'), { status: 403 })
      await client.query('INSERT INTO workspace_member_sites (member_id,site_id,role) VALUES ($1,$2,$3)', [member.rows[0].id, siteId, 'owner'])
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
      AND NOT (
        provider='buffer' AND channel<>'buffer'
        AND EXISTS (
          SELECT 1 FROM channel_connections aggregate
          WHERE aggregate.site_id=channel_connections.site_id
            AND aggregate.provider='buffer' AND aggregate.channel='buffer'
        )
      )
    ORDER BY channel,provider,updated_at DESC
  `, siteId ? [workspaceId, siteId] : [workspaceId])
  return result.rows
}

export async function upsertBrandConnection({ workspaceId, siteId, userId, role, channel, provider, externalAccountId, credentialsCiphertext = null, config = {}, capabilities = {}, status = 'connected' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const normalizedChannel = required(channel, 'channel', 80).toLowerCase()
  const normalizedProvider = required(provider, 'provider', 80).toLowerCase()
  const aggregateBuffer = normalizedProvider === 'buffer' && normalizedChannel === 'buffer'
  if (!aggregateBuffer && !CHANNEL_CATALOG.some(({ id: value }) => value === normalizedChannel)) throw Object.assign(new Error('Canal no válido.'), { status: 400 })
  if (normalizedChannel === 'blog' && normalizedProvider === 'buffer') throw Object.assign(new Error('El Blog se publica mediante el webhook de Coolify, no por Buffer.'), { status: 409, code: 'BLOG_WEBHOOK_REQUIRED' })
  if (normalizedChannel === 'instagram_story' && normalizedProvider !== 'buffer') throw Object.assign(new Error('Instagram Story se publica mediante Buffer.'), { status: 409, code: 'INSTAGRAM_STORY_BUFFER_REQUIRED' })
  const storedChannel = aggregateBuffer ? 'buffer' : connectionChannel(normalizedChannel)
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    if (aggregateBuffer) {
      await client.query("UPDATE channel_connections SET status='disabled',is_primary=FALSE,updated_at=NOW() WHERE site_id=$1 AND provider='buffer' AND channel<>'buffer'", [siteId])
    } else {
      await client.query('UPDATE channel_connections SET is_primary=FALSE,updated_at=NOW() WHERE site_id=$1 AND channel=$2 AND provider<>$3', [siteId, storedChannel, normalizedProvider])
    }
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
    `, [randomUUID(), workspaceId, siteId, storedChannel, normalizedProvider, text(externalAccountId, 200) || null, credentialsCiphertext || null, JSON.stringify(jsonObject(config)), JSON.stringify(jsonObject(capabilities)), text(status, 40) || 'connected'])
    if (aggregateBuffer) {
      // The aggregate row is the source of truth. Remove only legacy Buffer
      // channel rows after the replacement has been written successfully.
      await client.query("DELETE FROM channel_connections WHERE site_id=$1 AND provider='buffer' AND channel<>'buffer'", [siteId])
      const channelIds = jsonObject(config?.channelIds || config?.channel_ids)
      const mappedChannels = Object.keys(channelIds).filter((value) => BUFFER_CHANNELS.includes(value))
      if (mappedChannels.includes('instagram')) mappedChannels.push('instagram_story')
      if ((channelIds.video || channelIds.instagram) && !mappedChannels.includes('video')) mappedChannels.push('video')
      const storedMappedChannels = [...new Set(mappedChannels.map((value) => connectionChannel(value)))]
      await client.query('UPDATE channel_connections SET is_primary=FALSE,updated_at=NOW() WHERE site_id=$1 AND channel=ANY($2::text[]) AND provider<>\'buffer\'', [siteId, storedMappedChannels])
      await client.query('UPDATE site_channels SET connection_status=$1,updated_at=NOW() WHERE site_id=$2 AND channel=ANY($3::text[])', [text(status, 40) || 'connected', siteId, [...new Set(mappedChannels)]])
    } else {
      await client.query('UPDATE site_channels SET connection_status=$1,updated_at=NOW() WHERE site_id=$2 AND channel IN ($3,$4)', [text(status, 40) || 'connected', siteId, storedChannel, normalizedChannel])
    }
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId, userId || null, 'brand.connection_updated', 'channel_connection', result.rows[0].id, JSON.stringify({ channel: normalizedChannel, provider: normalizedProvider })])
    return result.rows[0]
  })
}

export async function disconnectBrandConnection({ workspaceId, siteId, connectionId, userId, role } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  const current = await pool.query('SELECT id,channel,provider FROM channel_connections WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [connectionId, workspaceId, siteId])
  if (!current.rowCount) throw Object.assign(new Error('Conexión no encontrada.'), { status: 404 })
  const row = current.rows[0]
  const result = row.provider === 'buffer'
    ? await pool.query("DELETE FROM channel_connections WHERE id=$1 AND workspace_id=$2 AND site_id=$3 RETURNING id,channel,provider,'disabled'::text AS status", [connectionId, workspaceId, siteId])
    : await pool.query("UPDATE channel_connections SET status='disabled',is_primary=FALSE,updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND site_id=$3 RETURNING id,channel,provider,status", [connectionId, workspaceId, siteId])
  if (result.rows[0].provider === 'buffer' && result.rows[0].channel === 'buffer') {
    await pool.query('UPDATE site_channels SET connection_status=\'not_connected\',updated_at=NOW() WHERE site_id=$1 AND channel=ANY($2::text[])', [siteId, BUFFER_CHANNELS])
  } else {
    await pool.query('UPDATE site_channels SET connection_status=\'not_connected\',updated_at=NOW() WHERE site_id=$1 AND channel IN ($2,\'instagram_story\')', [siteId, result.rows[0].channel])
  }
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, siteId, userId || null, 'brand.connection_disconnected', 'channel_connection', connectionId])
  return result.rows[0]
}

export async function listWorkspaceMembers({ workspaceId } = {}) {
  const pool = await poolOrThrow()
  const result = await pool.query(`
    SELECT wm.id,wm.user_id AS "userId",wm.role,wm.review_required AS "reviewRequired",wm.created_at AS "createdAt",wm.updated_at AS "updatedAt",
           COALESCE(json_agg(DISTINCT jsonb_build_object('id',s.id,'handle',s.handle,'name',s.name,'role',wms.role)) FILTER (WHERE s.id IS NOT NULL),'[]'::json) AS brands
    FROM workspace_members wm
    LEFT JOIN workspace_member_sites wms ON wms.member_id=wm.id
    LEFT JOIN sites s ON s.id=wms.site_id
    WHERE wm.workspace_id=$1
    GROUP BY wm.id
    ORDER BY wm.created_at ASC
  `, [workspaceId])
  return result.rows
}

export async function addWorkspaceMember({ workspaceId, userId, role = 'viewer', siteIds = [], brandRoles = {}, reviewRequired = null } = {}) {
  if (!WORKSPACE_ROLES.includes(role)) throw Object.assign(new Error('Rol no válido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const memberId = id(`member-${workspaceId}-${userId}`)
    const workspaceRole = ['owner', 'admin', 'approver', 'editor'].includes(role) ? role : 'viewer'
    const member = await client.query('INSERT INTO workspace_members (id,workspace_id,user_id,role,review_required) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,review_required=COALESCE(EXCLUDED.review_required,workspace_members.review_required),updated_at=NOW() RETURNING id,workspace_id AS "workspaceId",user_id AS "userId",role,review_required AS "reviewRequired"', [memberId, workspaceId, userId, workspaceRole, reviewRequired === null ? null : Boolean(reviewRequired)])
    for (const siteId of [...new Set(siteIds.filter(Boolean))]) {
      const brandRole = BRAND_ROLES.includes(brandRoles?.[siteId]) ? brandRoles[siteId] : (BRAND_ROLES.includes(role) ? role : 'viewer')
      await client.query('INSERT INTO workspace_member_sites (member_id,site_id,role) SELECT $1,s.id,$4 FROM sites s WHERE s.id=$2 AND s.workspace_id=$3 ON CONFLICT (member_id,site_id) DO UPDATE SET role=EXCLUDED.role', [member.rows[0].id, siteId, workspaceId, brandRole])
    }
    return member.rows[0]
  })
}

export async function updateWorkspaceMember({ workspaceId, userId, role = 'viewer', siteIds, brandRoles = {}, reviewRequired } = {}) {
  if (!WORKSPACE_ROLES.includes(role)) throw Object.assign(new Error('Rol no válido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const workspaceRole = ['owner', 'admin', 'approver', 'editor'].includes(role) ? role : 'viewer'
    const update = reviewRequired === undefined
      ? { sql: 'UPDATE workspace_members SET role=$1,updated_at=NOW() WHERE workspace_id=$2 AND user_id=$3 RETURNING id,workspace_id AS "workspaceId",user_id AS "userId",role,review_required AS "reviewRequired"', values: [workspaceRole, workspaceId, userId] }
      : { sql: 'UPDATE workspace_members SET role=$1,review_required=$4,updated_at=NOW() WHERE workspace_id=$2 AND user_id=$3 RETURNING id,workspace_id AS "workspaceId",user_id AS "userId",role,review_required AS "reviewRequired"', values: [workspaceRole, workspaceId, userId, Boolean(reviewRequired)] }
    const member = await client.query(update.sql, update.values)
    if (!member.rowCount) throw Object.assign(new Error('Miembro no encontrado.'), { status: 404 })
    if (Array.isArray(siteIds)) {
      await client.query('DELETE FROM workspace_member_sites WHERE member_id=$1', [member.rows[0].id])
      for (const siteId of [...new Set(siteIds.filter(Boolean))]) {
        const brandRole = BRAND_ROLES.includes(brandRoles?.[siteId]) ? brandRoles[siteId] : (BRAND_ROLES.includes(role) ? role : 'viewer')
        await client.query('INSERT INTO workspace_member_sites (member_id,site_id,role) SELECT $1,s.id,$4 FROM sites s WHERE s.id=$2 AND s.workspace_id=$3 ON CONFLICT (member_id,site_id) DO UPDATE SET role=EXCLUDED.role', [member.rows[0].id, siteId, workspaceId, brandRole])
      }
    }
    return member.rows[0]
  })
}

export async function setWorkspaceFeatureFlags({ workspaceId, siteId, userId, role, flags = {} } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin'])
  const pool = await poolOrThrow()
  const allowed = ['creation_ui_enabled', 'manual_creation_enabled', 'content_review_enabled']
  const clean = Object.fromEntries(allowed.filter((key) => flags[key] !== undefined).map((key) => [key, Boolean(flags[key])]))
  for (const [key, value] of Object.entries(clean)) {
    if (siteId) await pool.query('INSERT INTO site_feature_flags (site_id,key,value,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (site_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()', [siteId, key, JSON.stringify(value), userId || null])
    else await pool.query('INSERT INTO workspace_feature_flags (workspace_id,key,value,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()', [workspaceId, key, JSON.stringify(value), userId || null])
  }
  await pool.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,metadata) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, siteId || null, userId || null, 'feature_flags.updated', 'feature_flags', JSON.stringify(clean)])
  return getWorkspaceFeatureFlags({ workspaceId, siteId })
}

export function normalizeReviewChannels(channels) {
  if (channels === undefined || channels === null) return null
  if (!Array.isArray(channels)) throw Object.assign(new Error('reviewChannels debe ser una lista de variantes.'), { status: 400, code: 'CONTENT_REVIEW_CHANNELS_INVALID' })
  const selected = [...new Set(channels.map((value) => text(value, 50).toLowerCase()).filter(Boolean))]
  if (!selected.length) throw Object.assign(new Error('Selecciona al menos una variante para enviar a revisión.'), { status: 400, code: 'CONTENT_REVIEW_CHANNEL_REQUIRED' })
  const invalid = selected.filter((channel) => !CONTENT_CHANNELS.includes(channel))
  if (invalid.length) throw Object.assign(new Error(`Canales no válidos: ${invalid.join(', ')}.`), { status: 400, code: 'CONTENT_CHANNEL_INVALID' })
  return selected
}

async function contentItemReadiness(client, itemId, reviewChannels = null) {
  const selected = normalizeReviewChannels(reviewChannels)
  const params = selected ? [itemId, selected] : [itemId]
  const channelClause = selected ? ' AND channel=ANY($2::text[])' : ''
  const variants = await client.query(`SELECT id,item_id,channel,body,status FROM content_variants WHERE item_id=$1${channelClause} ORDER BY created_at`, params)
  if (!variants.rowCount) throw Object.assign(new Error('El item no tiene variantes.'), { status: 409, code: 'CONTENT_VARIANT_REQUIRED' })
  if (selected && variants.rowCount !== selected.length) {
    const found = new Set(variants.rows.map((variant) => variant.channel))
    const missing = selected.filter((channel) => !found.has(channel))
    throw Object.assign(new Error(`No existen variantes para: ${missing.join(', ')}.`), { status: 409, code: 'CONTENT_VARIANT_REQUIRED' })
  }
  const hydrated = await attachVariantMedia(client, variants.rows)
  const assessed = hydrated.map((variant) => ({ state: assessVariant(variant).state, fields: reviewMissingVariantFields(variant) }))
  const incomplete = assessed.filter((entry) => entry.fields.length)
  return {
    complete: incomplete.length === 0,
    incomplete: incomplete.map((entry) => ({ channel: entry.state.channel, fields: entry.fields })),
    diagnostics: incomplete.map((entry) => validationDiagnostic(itemId, entry.state, entry.fields))
  }
}

async function markContentReady(client, itemId, readiness = null, reviewChannels = null) {
  const selected = normalizeReviewChannels(reviewChannels)
  const result = readiness || await contentItemReadiness(client, itemId, selected)
  if (!result.complete) {
    for (const entry of result.diagnostics || []) console.info(JSON.stringify(entry))
    throw Object.assign(new Error('Faltan variantes o medios antes de enviar a revisión.'), { status: 409, code: 'CONTENT_INCOMPLETE', extra: { incomplete: result.incomplete, diagnostics: result.diagnostics || [] } })
  }
  const params = selected ? [itemId, selected] : [itemId]
  const channelClause = selected ? ' AND channel=ANY($2::text[])' : ''
  await client.query(`UPDATE content_variants SET status='generated',updated_at=NOW() WHERE item_id=$1${channelClause} AND status NOT IN ('published','canceled')`, params)
  const updated = await client.query("UPDATE content_items SET status='generated',error=NULL,updated_at=NOW() WHERE id=$1 RETURNING batch_id", [itemId])
  await client.query(`UPDATE content_batches cb SET total_items=counts.total,generated_items=counts.generated,failed_items=counts.failed,
    status=CASE WHEN counts.generated=counts.total THEN 'generated' ELSE cb.status END,updated_at=NOW()
    FROM (SELECT batch_id,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status='generated')::int AS generated,COUNT(*) FILTER (WHERE status='failed')::int AS failed FROM content_items WHERE batch_id=$1 GROUP BY batch_id) counts
    WHERE cb.id=counts.batch_id`, [updated.rows[0].batch_id])
}

export async function updateContentItem({ workspaceId, siteId, itemId, userId, role, topic, contentTitle, body, channel, visualBrief, mediaAssetIds, readyForReview = false, reviewChannels = null, keepPublished = false, quotaExempt = false, reviewRequired = true } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor', 'author'])
  if (keepPublished) assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const item = await client.query(`SELECT * FROM content_items WHERE id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
    if (!item.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
    if (topic !== undefined) await client.query('UPDATE content_items SET topic=$1,status=CASE WHEN status IN (\'approved\',\'scheduled\',\'published\') THEN \'needs_review\' ELSE status END,updated_at=NOW() WHERE id=$2', [required(topic, 'topic', 500), itemId])
    const currentMetadata = jsonObject(item.rows[0].metadata)
    if (contentTitle !== undefined) {
      const cleanTitle = normalizeBlogTitle(required(contentTitle, 'contentTitle', 500))
      await client.query(`UPDATE content_items SET metadata=$1,status=${keepPublished ? 'status' : "CASE WHEN status IN ('approved','scheduled','published') THEN 'needs_review' ELSE status END"},updated_at=NOW() WHERE id=$2`, [JSON.stringify({ ...currentMetadata, contentTitle: cleanTitle }), itemId])
    }
    if (body !== undefined || visualBrief !== undefined || Array.isArray(mediaAssetIds) || keepPublished) {
      const cleanChannel = required(channel, 'channel', 50).toLowerCase()
      if (!CONTENT_CHANNELS.includes(cleanChannel)) throw Object.assign(new Error('Canal no válido.'), { status: 400 })
      let currentVariant = await client.query('SELECT id,status,body FROM content_variants WHERE item_id=$1 AND channel=$2', [itemId, cleanChannel])
      if (keepPublished && (cleanChannel !== 'blog' || currentVariant.rows[0]?.status !== 'published')) throw Object.assign(new Error('Solo se puede conservar publicada una variante de Blog ya publicada.'), { status: 409, code: 'PUBLISHED_BLOG_REQUIRED' })
      if (!currentVariant.rowCount) {
        const createdVariant = await client.query('INSERT INTO content_variants (id,item_id,workspace_id,channel,status,body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,status,body', [randomUUID(), itemId, workspaceId, cleanChannel, 'draft', JSON.stringify({})])
        currentVariant = createdVariant
      }
      const currentBody = currentVariant.rows[0]?.body && typeof currentVariant.rows[0].body === 'object' ? currentVariant.rows[0].body : {}
      let nextBody = nextVariantBody({ currentBody, body, visualBrief })
      if (keepPublished) {
        const slug = blogPublicationSlug({ content_title: currentMetadata.contentTitle, topic: item.rows[0].topic, blog_body: currentBody })
        nextBody = { ...nextBody, ...(slug ? { slug } : {}), dateModified: new Date().toISOString() }
      }
      await client.query(`UPDATE content_variants SET body=$1,status=${keepPublished ? 'status' : "CASE WHEN status IN ('approved','scheduled','published') THEN 'needs_review' ELSE status END"},updated_at=NOW() WHERE item_id=$2 AND channel=$3`, [JSON.stringify(nextBody), itemId, cleanChannel])
      const socialCopyChanged = body !== undefined && ['instagram', 'instagram_story'].includes(cleanChannel) && currentVariant.rowCount && JSON.stringify(currentBody) !== JSON.stringify(nextBody)
      if (socialCopyChanged) {
        const staleMedia = await client.query('SELECT media_asset_id FROM content_variant_media WHERE variant_id=$1', [currentVariant.rows[0].id])
        await client.query('DELETE FROM content_variant_media WHERE variant_id=$1', [currentVariant.rows[0].id])
        if (staleMedia.rowCount) {
          await client.query("UPDATE media_assets SET metadata = metadata || jsonb_build_object('contentCopyStale', true, 'contentCopyStaleAt', NOW()) WHERE id = ANY($1::text[])", [staleMedia.rows.map((row) => row.media_asset_id)])
        }
      }
      if (Array.isArray(mediaAssetIds) && currentVariant.rowCount) {
        await client.query('DELETE FROM content_variant_media WHERE variant_id=$1', [currentVariant.rows[0].id])
        for (let index = 0; index < mediaAssetIds.slice(0, 20).length; index++) {
          const assetId = text(mediaAssetIds[index], 160)
          const owned = await client.query('SELECT id,metadata FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [assetId, workspaceId, siteId])
          if (!owned.rowCount) throw Object.assign(new Error('El mediaAssetId no existe o no pertenece a esta marca.'), { status: 404, code: 'MEDIA_ASSET_NOT_FOUND' })
          assertContentMediaAttachable(owned.rows[0].metadata, [cleanChannel])
          await client.query('INSERT INTO content_variant_media (variant_id,media_asset_id,sort_order) VALUES ($1,$2,$3)', [currentVariant.rows[0].id, assetId, index])
        }
      }
    }
    const contentChanged = topic !== undefined || contentTitle !== undefined || body !== undefined || visualBrief !== undefined || Array.isArray(mediaAssetIds) || keepPublished
    if (contentChanged) await client.query('UPDATE content_items SET workflow_revision=workflow_revision+1,updated_at=NOW() WHERE id=$1', [itemId])
    if (keepPublished) {
      const eventId = randomUUID()
      const current = await client.query('SELECT workflow_revision FROM content_items WHERE id=$1', [itemId])
      const itemRevision = Number(current.rows[0]?.workflow_revision || 0)
      await client.query('INSERT INTO outbox_events (id,workspace_id,type,aggregate_type,aggregate_id,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7)', [eventId, workspaceId, 'content.blog.updated', 'content_item', itemId, JSON.stringify({ itemId, itemRevision, channels: ['blog'], quotaExempt }), `blog-update:${itemId}:${itemRevision}`])
    }
    if (readyForReview) {
      await markContentReady(client, itemId, null, reviewChannels)
      if (!reviewRequired) {
        const selected = normalizeReviewChannels(reviewChannels)
        const params = selected ? [itemId, selected] : [itemId]
        const channelClause = selected ? ' AND channel=ANY($2::text[])' : ''
        await client.query(`UPDATE content_variants SET status='approved',updated_at=NOW() WHERE item_id=$1${channelClause} AND status='generated'`, params)
        await client.query("UPDATE content_items SET status='approved',error=NULL,updated_at=NOW() WHERE id=$1", [itemId])
      }
    }
    await client.query('INSERT INTO audit_log (workspace_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, userId || null, 'content.item_updated', 'content_item', itemId, JSON.stringify({ topic: topic !== undefined, contentTitle: contentTitle !== undefined, body: body !== undefined, visualBrief: visualBrief !== undefined, readyForReview: Boolean(readyForReview), keepPublished: Boolean(keepPublished) })])
    return (await client.query('SELECT * FROM content_items WHERE id=$1', [itemId])).rows[0]
  })
}

export async function addContentItemToBatch({ workspaceId, siteId, batchId, itemId, userId, role } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const target = await client.query('SELECT id,title FROM content_batches WHERE id=$1 AND workspace_id=$2 AND site_id=$3 FOR UPDATE', [batchId, workspaceId, siteId])
    if (!target.rowCount) throw Object.assign(new Error('Release no encontrado.'), { status: 404, code: 'release_not_found' })
    const item = await client.query('SELECT id,batch_id FROM content_items WHERE id=$1 AND workspace_id=$2 AND site_id=$3 FOR UPDATE', [itemId, workspaceId, siteId])
    if (!item.rowCount) throw Object.assign(new Error('Post no encontrado.'), { status: 404, code: 'post_not_found' })
    await client.query('UPDATE content_items SET batch_id=$1,updated_at=NOW() WHERE id=$2', [batchId, itemId])
    await client.query('UPDATE content_batches SET total_items=(SELECT COUNT(*) FROM content_items WHERE batch_id=$1),updated_at=NOW() WHERE id=$1', [batchId])
    return { batchId, postId: itemId, release: target.rows[0] }
  })
}

async function transitionVariantInTransaction(client, { workspaceId, siteId, itemId, userId, role, action, comment = '', quotaExempt = false } = {}) {
  const result = await client.query(`SELECT cv.*, ci.site_id, ci.workflow_revision, ci.status AS "itemStatus" FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteId ? 'AND ci.site_id=$3' : ''} FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
  if (!result.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
  if (action === 'approved' && String(result.rows[0].itemStatus || '') === 'draft') {
    throw Object.assign(new Error('No se puede aprobar un borrador incompleto. El contenido debe estar en generated (pendiente de revisión).'), {
      status: 409,
      code: 'APPROVE_REQUIRES_GENERATED'
    })
  }
  const reviewable = result.rows.filter((variant) => ['generated', 'needs_review'].includes(String(variant.status || '').toLowerCase()))
  const next = action === 'approved' ? 'approved' : 'needs_review'
  const nextItem = result.rows.some((variant) => variant.status === 'scheduled') ? 'scheduled' : next
  const changed = reviewable.length > 0
  if (changed) {
    await client.query("UPDATE content_variants SET status=$1,updated_at=NOW() WHERE item_id=$2 AND status=ANY($3::text[])", [next, itemId, ['generated', 'needs_review']])
    const itemRevision = Number(result.rows[0].workflow_revision || 0) + 1
    await client.query('UPDATE content_items SET status=$1,workflow_revision=$2,error=NULL,updated_at=NOW() WHERE id=$3', [nextItem, itemRevision, itemId])
    await client.query(`UPDATE content_batches cb SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status NOT IN ('approved','scheduled','published')) THEN 'approved' WHEN EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status='needs_review') THEN 'needs_review' ELSE cb.status END,updated_at=NOW() WHERE cb.id=(SELECT batch_id FROM content_items WHERE id=$1)`, [itemId])
    for (const variant of reviewable) {
      await client.query('INSERT INTO approvals (id,variant_id,user_id,action,comment) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), variant.id, userId || null, action, text(comment, 2000) || null])
    }
    if (action === 'approved') {
      await client.query('INSERT INTO outbox_events (id,workspace_id,type,aggregate_type,aggregate_id,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, 'content.item.approved', 'content_item', itemId, JSON.stringify({ itemId, itemRevision, quotaExempt }), `approve:${itemId}:${itemRevision}`])
      await client.query("UPDATE video_jobs SET status='approved',updated_at=NOW() WHERE content_item_id=$1 AND status IN ('ready_for_review','approved')", [itemId])
    }
  }
  return { itemId, status: nextItem }
}

async function transitionVariant({ workspaceId, siteId, itemId, userId, role, action, comment = '', quotaExempt = false } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, (client) => transitionVariantInTransaction(client, { workspaceId, siteId, itemId, userId, role, action, comment, quotaExempt }))
}

export const approveContentItem = (args) => transitionVariant({ ...args, action: 'approved' })
export const rejectContentItem = (args) => transitionVariant({ ...args, action: 'rejected' })

export async function approveContentBatch({ workspaceId, siteId, batchId, userId, role, quotaExempt = false } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const items = await client.query(`SELECT id FROM content_items WHERE batch_id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} ORDER BY created_at FOR UPDATE`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
    if (!items.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
    const results = []
    for (const item of items.rows) results.push(await transitionVariantInTransaction(client, { workspaceId, siteId, itemId: item.id, userId, role, action: 'approved', quotaExempt }))
    return { batchId, items: results }
  })
}

export async function rejectContentBatch({ workspaceId, siteId, batchId, userId, role, comment = '' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const items = await client.query(`SELECT id FROM content_items WHERE batch_id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} ORDER BY created_at FOR UPDATE`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
    if (!items.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
    const results = []
    for (const item of items.rows) results.push(await transitionVariantInTransaction(client, { workspaceId, siteId, itemId: item.id, userId, role, action: 'rejected', comment }))
    return { batchId, items: results }
  })
}

export async function scheduleContentItem({ workspaceId, siteId, itemId, userId, role, channels, publicationDate, timezone = 'UTC', publishNow = false, quotaExempt = false, _client = null } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const date = new Date(publicationDate)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400 })
  if (!publishNow && date.getTime() <= Date.now()) throw Object.assign(new Error('La fecha de agenda debe estar en el futuro. Usa publicar ahora para una publicación inmediata.'), { status: 400, code: 'PAST_PUBLICATION_DATE' })
  const pool = await poolOrThrow()
  const run = async (client) => {
    const requestedChannels = [...new Set((Array.isArray(channels) ? channels : []).map((value) => text(value, 50).toLowerCase()))]
    if (requestedChannels.includes('substack')) throw Object.assign(new Error('La publicación en Substack está suspendida porque no hay API disponible.'), { status: 409, code: 'SUBSTACK_PUBLISHING_SUSPENDED' })
    const invalidChannels = requestedChannels.filter((value) => !CONTENT_CHANNELS.includes(value))
    if (invalidChannels.length) throw Object.assign(new Error(`Canales no válidos: ${invalidChannels.join(', ')}.`), { status: 400 })
    const selectedChannels = requestedChannels
    const params = siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId]
    if (selectedChannels.length) params.push(selectedChannels)
    const channelClause = selectedChannels.length ? `AND cv.channel=ANY($${params.length}::text[])` : ''
    const variants = await client.query(`SELECT cv.id,cv.channel,ci.workflow_revision FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteId ? 'AND ci.site_id=$3' : ''} ${channelClause} AND cv.status='approved' FOR UPDATE`, params)
    if (!selectedChannels.length && variants.rows.some((variant) => variant.channel === 'substack')) throw Object.assign(new Error('La publicación en Substack está suspendida porque no hay API disponible.'), { status: 409, code: 'SUBSTACK_PUBLISHING_SUSPENDED' })
    if (!variants.rowCount) throw Object.assign(new Error('El item debe estar aprobado antes de agendarlo.'), { status: 409 })
    for (const variant of variants.rows) {
      await client.query('INSERT INTO schedules (id,variant_id,publication_date,timezone,status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (variant_id) DO UPDATE SET publication_date=EXCLUDED.publication_date,timezone=EXCLUDED.timezone,status=EXCLUDED.status,last_error=NULL,provider_post_id=NULL,attempts=0,updated_at=NOW()', [randomUUID(), variant.id, date.toISOString(), text(timezone, 80) || 'UTC', 'scheduled'])
      await client.query('UPDATE content_variants SET status=\'scheduled\',updated_at=NOW() WHERE id=$1', [variant.id])
    }
    const itemRevision = Number(variants.rows[0]?.workflow_revision || 0) + 1
    await client.query('UPDATE content_items SET status=\'scheduled\',workflow_revision=$2,updated_at=NOW() WHERE id=$1', [itemId, itemRevision])
    await client.query(`UPDATE content_batches cb SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status NOT IN ('scheduled','published')) THEN 'scheduled' ELSE cb.status END,updated_at=NOW() WHERE cb.id=(SELECT batch_id FROM content_items WHERE id=$1)`, [itemId])
    const scheduledChannels = variants.rows.map((variant) => variant.channel)
    await client.query('INSERT INTO outbox_events (id,workspace_id,type,aggregate_type,aggregate_id,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, 'content.item.scheduled', 'content_item', itemId, JSON.stringify({ itemId, itemRevision, channels: scheduledChannels, quotaExempt }), `schedule:${itemId}:${itemRevision}:${date.toISOString()}:${scheduledChannels.slice().sort().join(',')}`])
    await client.query('INSERT INTO audit_log (workspace_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6)', [workspaceId, userId || null, 'content.item_scheduled', 'content_item', itemId, JSON.stringify({ publicationDate: date.toISOString(), timezone, channels: scheduledChannels })])
    await client.query("UPDATE video_jobs SET status='scheduled',updated_at=NOW() WHERE content_item_id=$1 AND status IN ('approved','scheduled','ready_for_review')", [itemId])
    return { itemId, status: 'scheduled', channels: scheduledChannels, publicationDate: date.toISOString(), timezone }
  }
  return _client ? run(_client) : withPgTransaction(pool, run)
}

export async function rescheduleContentItem({ workspaceId, siteId, itemId, userId, role, channels, publicationDate, timezone = 'UTC', publishNow = false, quotaExempt = false } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const date = new Date(publicationDate)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400 })
  if (!publishNow && date.getTime() <= Date.now()) throw Object.assign(new Error('La fecha de agenda debe estar en el futuro. Usa publicar ahora para una publicación inmediata.'), { status: 400, code: 'PAST_PUBLICATION_DATE' })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const requestedChannels = [...new Set((Array.isArray(channels) ? channels : []).map((value) => text(value, 50).toLowerCase()))]
    const invalidChannels = requestedChannels.filter((value) => !CONTENT_CHANNELS.includes(value))
    if (invalidChannels.length) throw Object.assign(new Error(`Canales no válidos: ${invalidChannels.join(', ')}.`), { status: 400 })
    if (requestedChannels.includes('substack')) throw Object.assign(new Error('La publicación en Substack está suspendida porque no hay API disponible.'), { status: 409, code: 'SUBSTACK_PUBLISHING_SUSPENDED' })
    if (!requestedChannels.length) throw Object.assign(new Error('Selecciona al menos un canal.'), { status: 400 })
    const params = siteId ? [itemId, workspaceId, siteId, requestedChannels] : [itemId, workspaceId, requestedChannels]
    const siteClause = siteId ? 'AND ci.site_id=$3' : ''
    const channelParam = siteId ? '$4' : '$3'
    const variants = await client.query(`SELECT cv.id,cv.channel,cv.status,s.status AS schedule_status,s.provider,s.provider_post_id,ci.workflow_revision FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteClause} AND cv.channel=ANY(${channelParam}::text[]) AND cv.status <> 'published' AND COALESCE(s.status, '') <> 'published' AND (cv.status IN ('failed','action_required','scheduled') OR s.status IN ('failed','action_required','scheduled')) FOR UPDATE OF cv`, params)
    const found = new Set(variants.rows.map((variant) => variant.channel))
    const missing = requestedChannels.filter((channel) => !found.has(channel))
    if (missing.length) throw Object.assign(new Error(`No se pueden mover porque ya se publicaron o no están programados: ${missing.join(', ')}.`), { status: 409, code: 'RESCHEDULE_CHANNEL_NOT_FAILED' })
    const moved = []
    for (const variant of variants.rows) {
      const keepRemote = variant.provider === 'buffer' && variant.provider_post_id && variant.schedule_status === 'scheduled'
      if (keepRemote) {
        moved.push(variant.channel)
        await client.query('UPDATE schedules SET publication_date=$2,timezone=$3,status=\'scheduled\',last_error=NULL,updated_at=NOW() WHERE variant_id=$1', [variant.id, date.toISOString(), text(timezone, 80) || 'UTC'])
      } else {
        await client.query('INSERT INTO schedules (id,variant_id,publication_date,timezone,status) VALUES ($1,$2,$3,$4,\'scheduled\') ON CONFLICT (variant_id) DO UPDATE SET publication_date=EXCLUDED.publication_date,timezone=EXCLUDED.timezone,status=EXCLUDED.status,last_error=NULL,provider_post_id=NULL,provider=NULL,attempts=0,updated_at=NOW()', [randomUUID(), variant.id, date.toISOString(), text(timezone, 80) || 'UTC'])
      }
      await client.query("UPDATE content_variants SET status='scheduled',updated_at=NOW() WHERE id=$1", [variant.id])
    }
    const itemRevision = Number(variants.rows[0]?.workflow_revision || 0) + 1
    await client.query("UPDATE content_items SET status=CASE WHEN EXISTS (SELECT 1 FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND (cv.status IN ('failed','action_required') OR s.status IN ('failed','action_required'))) THEN 'failed' ELSE 'scheduled' END,workflow_revision=$2,updated_at=NOW() WHERE id=$1", [itemId, itemRevision])
    await client.query(`UPDATE content_batches cb SET status=CASE WHEN EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status='failed') THEN 'failed' WHEN NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status NOT IN ('scheduled','published','canceled')) THEN 'scheduled' ELSE cb.status END,updated_at=NOW() WHERE cb.id=(SELECT batch_id FROM content_items WHERE id=$1)`, [itemId])
    const scheduledChannels = variants.rows.map((variant) => variant.channel)
    await client.query('INSERT INTO outbox_events (id,workspace_id,type,aggregate_type,aggregate_id,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, 'content.item.scheduled', 'content_item', itemId, JSON.stringify({ itemId, itemRevision, channels: scheduledChannels, retry: true, moveChannels: moved, quotaExempt }), `reschedule:${itemId}:${itemRevision}:${date.toISOString()}:${scheduledChannels.slice().sort().join(',')}`])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'content.item_rescheduled', 'content_item', itemId, JSON.stringify({ publicationDate: date.toISOString(), timezone, channels: scheduledChannels })])
    return { itemId, status: 'scheduled', channels: scheduledChannels, publicationDate: date.toISOString(), timezone }
  })
}

export async function markContentChannelPublished({ workspaceId, siteId, itemId, userId, role, channel } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const selected = text(channel, 50).toLowerCase()
  if (!CONTENT_CHANNELS.includes(selected)) throw Object.assign(new Error('Canal no válido.'), { status: 400 })
  if (selected === 'substack') throw Object.assign(new Error('La publicación en Substack está suspendida porque no hay API disponible.'), { status: 409, code: 'SUBSTACK_PUBLISHING_SUSPENDED' })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const params = siteId ? [itemId, workspaceId, siteId, selected] : [itemId, workspaceId, selected]
    const siteClause = siteId ? 'AND ci.site_id=$3' : ''
    const channelParam = siteId ? '$4' : '$3'
    const variants = await client.query(`SELECT cv.id FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteClause} AND cv.channel=${channelParam} AND (cv.status IN ('failed','action_required') OR s.status IN ('failed','action_required')) FOR UPDATE OF cv`, params)
    if (!variants.rowCount) throw Object.assign(new Error('Ese canal no tiene un error que cerrar.'), { status: 409, code: 'CHANNEL_NOT_FAILED' })
    await client.query("UPDATE content_variants SET status='published',updated_at=NOW() WHERE id=$1", [variants.rows[0].id])
    await client.query("UPDATE schedules SET status='published',last_error=NULL,updated_at=NOW() WHERE variant_id=$1", [variants.rows[0].id])
    await client.query(`UPDATE content_items SET status=CASE
      WHEN EXISTS (SELECT 1 FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND (cv.status IN ('failed','action_required') OR s.status IN ('failed','action_required'))) THEN 'failed'
      WHEN NOT EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=$1 AND cv.status NOT IN ('published','canceled')) THEN 'published'
      ELSE 'scheduled' END, error=NULL, updated_at=NOW() WHERE id=$1`, [itemId])
    await client.query(`UPDATE content_batches cb SET status=CASE WHEN EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status='failed') THEN 'failed' WHEN NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status NOT IN ('scheduled','published','canceled')) THEN 'scheduled' ELSE cb.status END,updated_at=NOW() WHERE cb.id=(SELECT batch_id FROM content_items WHERE id=$1)`, [itemId])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'content.channel_marked_published', 'content_item', itemId, JSON.stringify({ channel: selected })])
    return { itemId, status: 'published', channel: selected }
  })
}

export async function reconcileContentItemScheduled({ workspaceId, siteId, itemId, userId, role, channels, publicationDate, timezone = 'UTC' } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const requestedChannels = [...new Set((Array.isArray(channels) ? channels : []).map((value) => text(value, 50).toLowerCase()))]
  const invalidChannels = requestedChannels.filter((value) => !CONTENT_CHANNELS.includes(value))
  if (invalidChannels.length) throw Object.assign(new Error(`Canales no válidos: ${invalidChannels.join(', ')}.`), { status: 400 })
  if (!requestedChannels.length) throw Object.assign(new Error('Selecciona al menos un canal.'), { status: 400 })
  const date = publicationDate === undefined ? null : new Date(publicationDate)
  if (date && !Number.isFinite(date.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const params = siteId ? [itemId, workspaceId, siteId, requestedChannels] : [itemId, workspaceId, requestedChannels]
    const siteClause = siteId ? 'AND ci.site_id=$3' : ''
    const channelParam = siteId ? '$4' : '$3'
    const variants = await client.query(`SELECT cv.id,cv.channel FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteClause} AND cv.channel=ANY(${channelParam}::text[]) FOR UPDATE OF cv`, params)
    const found = new Set(variants.rows.map((variant) => variant.channel))
    const missing = requestedChannels.filter((channel) => !found.has(channel))
    if (missing.length) throw Object.assign(new Error(`No existen variantes para: ${missing.join(', ')}.`), { status: 409 })
    for (const variant of variants.rows) {
      if (date) await client.query('UPDATE schedules SET publication_date=$2,timezone=$3,status=\'scheduled\',last_error=NULL,updated_at=NOW() WHERE variant_id=$1', [variant.id, date.toISOString(), text(timezone, 80) || 'UTC'])
      else await client.query("UPDATE schedules SET status='scheduled',last_error=NULL,updated_at=NOW() WHERE variant_id=$1", [variant.id])
      await client.query("UPDATE content_variants SET status='scheduled',updated_at=NOW() WHERE id=$1", [variant.id])
    }
    await client.query("UPDATE content_items SET status=CASE WHEN EXISTS (SELECT 1 FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND (cv.status IN ('failed','action_required') OR s.status IN ('failed','action_required'))) THEN 'failed' ELSE 'scheduled' END,error=NULL,updated_at=NOW() WHERE id=$1", [itemId])
    await client.query(`UPDATE content_batches cb SET status=CASE WHEN EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status='failed') THEN 'failed' WHEN NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.batch_id=cb.id AND ci.status NOT IN ('scheduled','published','canceled')) THEN 'scheduled' ELSE cb.status END,updated_at=NOW() WHERE cb.id=(SELECT batch_id FROM content_items WHERE id=$1)`, [itemId])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'content.item_schedule_reconciled', 'content_item', itemId, JSON.stringify({ channels: requestedChannels, publicationDate: date?.toISOString() || null, timezone })])
    return { itemId, status: 'scheduled', channels: requestedChannels, publicationDate: date?.toISOString() || null, timezone }
  })
}

export async function clearPublishedContentErrors({ workspaceId, siteId, itemId, userId, role, channels } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const requestedChannels = [...new Set((Array.isArray(channels) ? channels : []).map((value) => text(value, 50).toLowerCase()))]
  const invalidChannels = requestedChannels.filter((value) => !CONTENT_CHANNELS.includes(value))
  if (invalidChannels.length) throw Object.assign(new Error(`Canales no válidos: ${invalidChannels.join(', ')}.`), { status: 400 })
  if (!requestedChannels.length) throw Object.assign(new Error('Selecciona al menos un canal.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const params = siteId ? [itemId, workspaceId, siteId, requestedChannels] : [itemId, workspaceId, requestedChannels]
    const siteClause = siteId ? 'AND ci.site_id=$3' : ''
    const channelParam = siteId ? '$4' : '$3'
    const rows = await client.query(`SELECT cv.channel FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteClause} AND cv.channel=ANY(${channelParam}::text[]) AND cv.status='published' AND s.status='published' AND s.last_error IS NOT NULL FOR UPDATE OF cv`, params)
    for (const row of rows.rows) {
      await client.query("UPDATE schedules SET last_error=NULL,updated_at=NOW() WHERE variant_id=(SELECT id FROM content_variants WHERE item_id=$1 AND channel=$2)", [itemId, row.channel])
    }
    await client.query(`UPDATE content_items SET error=(SELECT string_agg(cv.channel || ': ' || s.last_error, chr(10) ORDER BY cv.channel) FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND s.last_error IS NOT NULL),updated_at=NOW() WHERE id=$1`, [itemId])
    if (rows.rowCount) await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'content.published_error_cleared', 'content_item', itemId, JSON.stringify({ channels: rows.rows.map((row) => row.channel) })])
    return { itemId, clearedChannels: rows.rows.map((row) => row.channel) }
  })
}

export async function reopenUnsentPublishedChannel({ workspaceId, siteId, itemId, userId, role, channel } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const selected = text(channel, 50).toLowerCase()
  if (!CONTENT_CHANNELS.includes(selected)) throw Object.assign(new Error('Canal no válido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const params = siteId ? [itemId, workspaceId, siteId, selected] : [itemId, workspaceId, selected]
    const siteClause = siteId ? 'AND ci.site_id=$3' : ''
    const channelParam = siteId ? '$4' : '$3'
    const result = await client.query(`SELECT cv.id,cv.status,s.status AS schedule_status,s.provider,s.provider_post_id,ci.workflow_revision FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteClause} AND cv.channel=${channelParam} FOR UPDATE OF cv`, params)
    if (!result.rowCount) throw Object.assign(new Error('La variante no existe.'), { status: 404 })
    const variant = result.rows[0]
    if (variant.status !== 'published' || variant.provider || variant.provider_post_id) throw Object.assign(new Error('La variante no es una publicación marcada como enviada sin proveedor.'), { status: 409, code: 'CHANNEL_NOT_UNSENT_PUBLISHED' })
    await client.query("UPDATE content_variants SET status='approved',updated_at=NOW() WHERE id=$1", [variant.id])
    await client.query("UPDATE schedules SET status='approved',provider=NULL,provider_post_id=NULL,attempts=0,last_error=NULL,updated_at=NOW() WHERE variant_id=$1", [variant.id])
    await client.query(`UPDATE content_items SET status=CASE
      WHEN EXISTS (SELECT 1 FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND (cv.status IN ('failed','action_required') OR s.status IN ('failed','action_required'))) THEN 'failed'
      WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=$1 AND cv.status='scheduled') THEN 'scheduled'
      WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=$1 AND cv.status='approved') THEN 'approved'
      WHEN NOT EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=$1 AND cv.status NOT IN ('published','canceled')) THEN 'published'
      ELSE status END,
      error=(SELECT string_agg(cv.channel || ': ' || s.last_error, chr(10) ORDER BY cv.channel) FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND s.last_error IS NOT NULL),
      workflow_revision=workflow_revision+1,updated_at=NOW() WHERE id=$1`, [itemId])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'content.unsent_published_channel_reopened', 'content_item', itemId, JSON.stringify({ channel: selected })])
    return { itemId, channel: selected, status: 'approved' }
  })
}

export function bufferPublishChannels(channels = ['instagram']) {
  const requestedChannels = [...new Set((Array.isArray(channels) ? channels : []).map((channel) => text(channel, 50).toLowerCase()))]
  if (requestedChannels.includes('blog')) throw Object.assign(new Error('El Blog se publica mediante el webhook de Coolify configurado en Administración.'), { status: 409, code: 'BLOG_WEBHOOK_REQUIRED' })
  if (requestedChannels.includes('substack')) throw Object.assign(new Error('La publicación en Substack está suspendida porque no hay API disponible.'), { status: 409, code: 'SUBSTACK_PUBLISHING_SUSPENDED' })
  const selectedChannels = requestedChannels.filter((channel) => ['instagram', 'instagram_story', 'linkedin', 'x', 'video'].includes(channel))
  if (!selectedChannels.length) throw Object.assign(new Error('Selecciona Instagram, Instagram Story, LinkedIn, X o Vídeo.'), { status: 400, code: 'BUFFER_CHANNEL_REQUIRED' })
  return selectedChannels
}

export function resolveBufferChannelId(config = {}, channel, fallback = '') {
  return bufferChannelId(config, channel, fallback)
}

export async function publishContentItemViaBuffer({ workspaceId, siteId, itemId, userId, role, channels = ['instagram'], copy = '', quotaExempt = false } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const selectedChannels = bufferPublishChannels(channels)
  const cleanCopy = text(copy, 10000)
  const pool = await poolOrThrow()
  const publicationDate = new Date()
  return withPgTransaction(pool, async (client) => {
    const item = await client.query(`SELECT id,batch_id,status,workflow_revision FROM content_items WHERE id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} FOR UPDATE`, siteId ? [itemId, workspaceId, siteId] : [itemId, workspaceId])
    if (!item.rowCount) throw Object.assign(new Error('Item no encontrado.'), { status: 404 })
    const variants = await client.query(`
      SELECT cv.id,cv.channel,cv.status,cv.body,cc.provider,cc.status AS "connectionStatus",cc.config,cc.external_account_id AS "externalAccountId"
      FROM content_variants cv
      LEFT JOIN LATERAL (
      SELECT provider,status,config,external_account_id AS "externalAccountId" FROM channel_connections
        WHERE workspace_id=cv.workspace_id AND site_id=$2 AND is_primary=TRUE
          AND (
            channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END
            OR (provider='buffer' AND channel='buffer')
          )
        ORDER BY CASE WHEN channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END THEN 0 ELSE 1 END,
                 updated_at DESC LIMIT 1
      ) cc ON TRUE
      WHERE cv.item_id=$1 AND cv.channel=ANY($3::text[])
      FOR UPDATE OF cv
    `, [itemId, siteId, selectedChannels])
    const found = new Set(variants.rows.map((variant) => variant.channel))
    const missing = selectedChannels.filter((channel) => !found.has(channel))
    if (missing.length) throw Object.assign(new Error(`El item no tiene variante para ${missing.join(', ')}.`), { status: 409, code: 'CONTENT_VARIANT_REQUIRED' })
    for (const variant of variants.rows) {
      if (variant.status === 'published') throw Object.assign(new Error(`${channelLabelForError(variant.channel)} ya está publicada.`), { status: 409, code: 'CONTENT_ALREADY_PUBLISHED' })
      if (variant.status !== 'approved') throw Object.assign(new Error(`Aprueba ${channelLabelForError(variant.channel)} antes de publicar.`), { status: 409, code: 'CONTENT_APPROVAL_REQUIRED' })
      if (String(variant.provider || '').toLowerCase() !== 'buffer' || String(variant.connectionStatus || '').toLowerCase() !== 'connected' || !resolveBufferChannelId(variant.config, variant.channel, variant.externalAccountId)) {
        throw Object.assign(new Error(`Conecta Buffer para ${channelLabelForError(variant.channel)} antes de publicar.`), { status: 409, code: 'BUFFER_CONNECTION_REQUIRED' })
      }
    }
    for (const variant of variants.rows) {
      if (cleanCopy) {
        await client.query('UPDATE content_variants SET body=$2,updated_at=NOW() WHERE id=$1', [variant.id, JSON.stringify({ ...jsonObject(variant.body), publishCopy: cleanCopy })])
      }
      await client.query(`
        INSERT INTO schedules (id,variant_id,publication_date,timezone,status)
        VALUES ($1,$2,$3,$4,'scheduled')
        ON CONFLICT (variant_id) DO UPDATE SET publication_date=EXCLUDED.publication_date,timezone=EXCLUDED.timezone,status='scheduled',updated_at=NOW()
      `, [randomUUID(), variant.id, publicationDate.toISOString(), 'UTC'])
      await client.query("UPDATE content_variants SET status='scheduled',updated_at=NOW() WHERE id=$1", [variant.id])
    }
    const itemRevision = Number(item.rows[0].workflow_revision || 0) + 1
    await client.query("UPDATE content_items SET status='scheduled',workflow_revision=$2,updated_at=NOW() WHERE id=$1", [itemId, itemRevision])
    await client.query('INSERT INTO outbox_events (id,workspace_id,type,aggregate_type,aggregate_id,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING', [randomUUID(), workspaceId, 'content.item.scheduled', 'content_item', itemId, JSON.stringify({ itemId, itemRevision, channels: selectedChannels, provider: 'buffer', quotaExempt }), `buffer-publish:${itemId}:${itemRevision}:${selectedChannels.slice().sort().join(',')}`])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'content.item_published_buffer', 'content_item', itemId, JSON.stringify({ channels: selectedChannels, publicationDate: publicationDate.toISOString() })])
    return { itemId, status: 'scheduled', channels: selectedChannels, publicationDate: publicationDate.toISOString(), provider: 'buffer' }
  })
}

function channelLabelForError(channel) { return channel === 'instagram_story' ? 'Instagram Story' : channel === 'instagram' ? 'Instagram' : channel === 'linkedin' ? 'LinkedIn' : channel === 'video' ? 'Vídeo' : 'Blog' }

export async function scheduleContentBatch({ workspaceId, siteId, batchId, userId, role, channels, publicationDate, timezone = 'UTC', publishNow = false, quotaExempt = false } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const pool = await poolOrThrow()
  const start = new Date(publicationDate)
  if (!Number.isFinite(start.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400 })
  return withPgTransaction(pool, async (client) => {
    const items = await client.query(`SELECT id FROM content_items WHERE batch_id=$1 AND workspace_id=$2 ${siteId ? 'AND site_id=$3' : ''} ORDER BY created_at FOR UPDATE`, siteId ? [batchId, workspaceId, siteId] : [batchId, workspaceId])
    if (!items.rowCount) throw Object.assign(new Error('Batch no encontrado.'), { status: 404 })
    const results = []
    for (let index = 0; index < items.rows.length; index++) {
      const date = new Date(start.getTime() + index * 60 * 60 * 1000)
      results.push(await scheduleContentItem({ workspaceId, siteId, itemId: items.rows[index].id, userId, role, channels, publicationDate: date.toISOString(), timezone, publishNow, quotaExempt, _client: client }))
    }
    return { batchId, items: results }
  })
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

export async function cancelContentChannel({ workspaceId, siteId, itemId, userId, role, channel } = {}) {
  assertWorkspaceRole(role, ['owner', 'admin', 'editor'])
  const selected = text(channel, 50).toLowerCase()
  if (!CONTENT_CHANNELS.includes(selected)) throw Object.assign(new Error('Canal no válido.'), { status: 400 })
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const params = siteId ? [itemId, workspaceId, siteId, selected] : [itemId, workspaceId, selected]
    const siteClause = siteId ? 'AND ci.site_id=$3' : ''
    const channelParam = siteId ? '$4' : '$3'
    const result = await client.query(`SELECT cv.id,cv.status,s.provider_post_id FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id LEFT JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$1 AND cv.workspace_id=$2 ${siteClause} AND cv.channel=${channelParam} FOR UPDATE OF cv`, params)
    if (!result.rowCount) throw Object.assign(new Error('La variante no existe.'), { status: 404 })
    const variant = result.rows[0]
    if (variant.status === 'canceled') return { itemId, channel: selected, status: 'canceled' }
    if (variant.status === 'published') throw Object.assign(new Error('Ese canal ya fue publicado y no se puede omitir.'), { status: 409, code: 'CONTENT_ALREADY_PUBLISHED' })
    if (variant.provider_post_id) throw Object.assign(new Error('Ese canal ya fue enviado al proveedor. Cancélalo allí antes de omitirlo en el CMS.'), { status: 409, code: 'CONTENT_PROVIDER_POST_EXISTS' })
    await client.query("UPDATE content_variants SET status='canceled',updated_at=NOW() WHERE id=$1", [variant.id])
    await client.query("UPDATE schedules SET status='canceled',last_error=NULL,updated_at=NOW() WHERE variant_id=$1 AND status<>'published'", [variant.id])
    const statuses = await client.query('SELECT status FROM content_variants WHERE item_id=$1', [itemId])
    const itemStatus = contentStatusFromVariantStatuses(statuses.rows.map((row) => row.status))
    await client.query(`UPDATE content_items SET status=$1,error=(SELECT string_agg(cv.channel || ': ' || s.last_error, chr(10) ORDER BY cv.channel) FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=$2 AND cv.status<>'canceled' AND s.last_error IS NOT NULL),updated_at=NOW() WHERE id=$2`, [itemStatus, itemId])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [workspaceId, siteId || null, userId || null, 'content.channel_canceled', 'content_item', itemId, JSON.stringify({ channel: selected })])
    return { itemId, channel: selected, status: 'canceled', itemStatus }
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

export async function recordUsage({ workspaceId, siteId, userId, kind, quantity = 1, idempotencyKey, metadata = {}, quotaExempt = false } = {}) {
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
    const event = { id: randomUUID(), workspaceId, siteId: siteId || null, userId: userId || null, kind: cleanKind, quantity: amount, period: currentPeriod }
    const inserted = await client.query('INSERT INTO usage_events (id,workspace_id,site_id,user_id,kind,quantity,period,idempotency_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id', [event.id, workspaceId, event.siteId, event.userId, event.kind, amount, currentPeriod, idempotencyKey ? text(idempotencyKey, 300) : null, JSON.stringify(jsonObject(metadata))])
    if (!inserted.rowCount && idempotencyKey) {
      const existing = await client.query('SELECT * FROM usage_events WHERE idempotency_key=$1', [text(idempotencyKey, 300)])
      return existing.rows[0] || event
    }
    if (!inserted.rowCount) return event
    await client.query('INSERT INTO usage_counters (workspace_id,period,kind,quantity) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,period,kind) DO UPDATE SET quantity=usage_counters.quantity+EXCLUDED.quantity,updated_at=NOW()', [workspaceId, currentPeriod, cleanKind, amount])
    return event
  })
}

export async function usageSnapshot({ workspaceId, period: requestedPeriod = period() } = {}) {
  const pool = await poolOrThrow()
  const rows = await pool.query('SELECT kind,quantity,updated_at AS "updatedAt" FROM usage_counters WHERE workspace_id=$1 AND period=$2 ORDER BY kind', [workspaceId, text(requestedPeriod, 7)])
  const limits = Object.fromEntries(USAGE_METRICS.map((kind) => [kind, 0]))
  const subscription = await pool.query('SELECT plan_id AS "planId",status,current_period_end AS "currentPeriodEnd" FROM subscriptions WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 1', [workspaceId])
  return { workspaceId, period: requestedPeriod, counters: Object.fromEntries(rows.rows.map((row) => [row.kind, row])), limits, subscription: subscription.rows[0] || null }
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

const REMOTE_PUBLICATION_SYNC_JOBS = ['buffer.sync', 'planable.sync', 'postiz.sync', 'metricool.sync']

export async function enqueueRemotePublicationStatusSync({ workspaceId, siteId = null, quotaExempt = false, force = false } = {}) {
  if (!workspaceId) throw Object.assign(new Error('workspaceId es obligatorio.'), { status: 400 })
  const bucket = new Date().toISOString().slice(0, 16)
  const siteKey = siteId || 'workspace'
  const jobs = []
  for (const type of REMOTE_PUBLICATION_SYNC_JOBS) {
    jobs.push(await enqueueJob({
      workspaceId,
      type,
      payload: { siteId, quotaExempt, force },
      idempotencyKey: `${type}:${workspaceId}:${siteKey}:${bucket}`
    }))
  }
  return { queued: jobs.length, bucket, types: REMOTE_PUBLICATION_SYNC_JOBS }
}

export async function claimJobs({ workerId = randomUUID(), limit = 5 } = {}) {
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const rows = await client.query(`SELECT id FROM jobs WHERE (status='queued' OR (status='running' AND locked_at < NOW() - ($2 * INTERVAL '1 millisecond'))) AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1`, [Math.min(Math.max(Number(limit) || 5, 1), 50), WORKER_LEASE_MS])
    if (!rows.rowCount) return []
    const ids = rows.rows.map((row) => row.id)
    const claimed = await client.query('UPDATE jobs SET status=\'running\',locked_at=NOW(),locked_by=$1,attempts=attempts+1,updated_at=NOW() WHERE id=ANY($2::text[]) RETURNING *', [workerId, ids])
    return claimed.rows
  })
}

export async function touchJob(idValue, { workerId } = {}) {
  if (!workerId) return { updated: false, leaseLost: true }
  const pool = await poolOrThrow()
  const result = await pool.query("UPDATE jobs SET locked_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='running' AND locked_by=$2", [idValue, workerId])
  return { updated: result.rowCount > 0, leaseLost: result.rowCount === 0 }
}

export async function finishJob(idValue, { workerId, ok, error = '', retryAt = null, deadLetter = false } = {}) {
  const pool = await poolOrThrow()
  const status = ok ? 'completed' : deadLetter ? 'dead_letter' : retryAt ? 'queued' : 'failed'
  const result = await pool.query('UPDATE jobs SET status=$1,last_error=$2,available_at=COALESCE($3,available_at),locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$4 AND status=\'running\' AND locked_by=$5', [status, text(error, 2000) || null, retryAt, idValue, workerId || ''])
  return { updated: result.rowCount > 0, leaseLost: result.rowCount === 0 }
}

export async function claimOutbox({ workerId = randomUUID(), limit = 10 } = {}) {
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const rows = await client.query(`SELECT id FROM outbox_events WHERE (status='pending' OR (status='processing' AND locked_at < NOW() - ($2 * INTERVAL '1 millisecond'))) AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1`, [Math.min(Math.max(Number(limit) || 10, 1), 50), WORKER_LEASE_MS])
    if (!rows.rowCount) return []
    const ids = rows.rows.map((row) => row.id)
    const claimed = await client.query('UPDATE outbox_events SET status=\'processing\',locked_at=NOW(),locked_by=$1,attempts=attempts+1 WHERE id=ANY($2::text[]) RETURNING *', [workerId, ids])
    return claimed.rows
  })
}

export async function touchOutbox(idValue, { workerId } = {}) {
  if (!workerId) return { updated: false, leaseLost: true }
  const pool = await poolOrThrow()
  const result = await pool.query("UPDATE outbox_events SET locked_at=NOW() WHERE id=$1 AND status='processing' AND locked_by=$2", [idValue, workerId])
  return { updated: result.rowCount > 0, leaseLost: result.rowCount === 0 }
}

export async function finishOutbox(idValue, { workerId, ok, error = '', retryAt = null, deadLetter = false } = {}) {
  const pool = await poolOrThrow()
  const status = ok ? 'delivered' : deadLetter ? 'dead_letter' : retryAt ? 'pending' : 'failed'
  const result = await pool.query('UPDATE outbox_events SET status=$1,last_error=$2,available_at=COALESCE($3,available_at),locked_at=NULL,locked_by=NULL,delivered_at=CASE WHEN $1=\'delivered\' THEN NOW() ELSE delivered_at END WHERE id=$4 AND status=\'processing\' AND locked_by=$5', [status, text(error, 2000) || null, retryAt, idValue, workerId || ''])
  return { updated: result.rowCount > 0, leaseLost: result.rowCount === 0 }
}
