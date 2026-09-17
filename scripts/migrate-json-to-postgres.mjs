import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, readDb } from '../lib/db.mjs'
import { getPgPool, runCoreMigrations, withPgTransaction } from '../lib/pg.mjs'
import { loadSiteConfig } from '../lib/site-config.mjs'
import { encryptSecret } from '../lib/secret-crypto.mjs'

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const json = (value) => JSON.stringify(value && typeof value === 'object' ? value : {})
const hash = (value) => createHash('sha256').update(String(value)).digest('hex')
const id = (value, fallback = randomUUID()) => clean(value, 160) || fallback
const isoDate = (value) => { const date = new Date(value || ''); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString() }
const publicMediaUrl = (value) => {
  const raw = clean(value, 1000)
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const origin = String(process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')
  return origin ? `${origin}/${raw.replace(/^\//, '')}` : raw
}

function readJson(name, fallback) {
  const file = join(dataDir, name)
  if (!existsSync(file)) return fallback
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export function createMigrationBackup({ destination = join(dataDir, 'migration-backups', new Date().toISOString().replace(/[:.]/g, '-')) } = {}) {
  mkdirSync(destination, { recursive: true })
  const files = ['db.json', 'users.json', 'access-tokens.json']
  const manifest = {}
  const copyOne = (name) => {
    const source = join(dataDir, name)
    if (!existsSync(source)) return
    const target = join(destination, name)
    copyFileSync(source, target)
    manifest[name] = { bytes: statSync(source).size, sha256: createHash('sha256').update(readFileSync(source)).digest('hex') }
  }
  for (const name of files) copyOne(name)
  for (const directory of ['site-config', 'brand', 'media']) {
    const sourceRoot = join(dataDir, directory)
    if (!existsSync(sourceRoot)) continue
    const walk = (source, relative) => {
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        const sourcePath = join(source, entry.name)
        const relativePath = join(relative, entry.name)
        const targetPath = join(destination, relativePath)
        if (entry.isDirectory()) {
          mkdirSync(targetPath, { recursive: true })
          walk(sourcePath, relativePath)
        } else if (entry.isFile()) {
          mkdirSync(join(destination, relative), { recursive: true })
          copyFileSync(sourcePath, targetPath)
          manifest[relativePath] = { bytes: statSync(sourcePath).size, sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex') }
        }
      }
    }
    walk(sourceRoot, directory)
  }
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), files: manifest }, null, 2), { mode: 0o600 })
  return { destination, files: manifest }
}

function mapRole(role) {
  if (role === 'admin') return 'admin'
  if (role === 'agency_admin') return 'owner'
  if (role === 'viewer') return 'viewer'
  if (role === 'author') return 'author'
  return 'editor'
}

function channelsForPost(post) {
  const pack = post?.socialPack && typeof post.socialPack === 'object' ? post.socialPack : {}
  const channels = ['blog']
  if (pack.linkedin) channels.push('linkedin')
  if (pack.x) channels.push('x')
  if (pack.substackBody || pack.substackTitle) channels.push('substack')
  if (pack.instagramCarousel || pack.instagramSlides) channels.push('instagram')
  if (pack.videoScript) channels.push('video')
  return channels
}
function contentStatus(status) {
  if (status === 'draft') return 'draft'
  if (['review', 'needs_review', 'pending_review', 'request_changes'].includes(status)) return 'needs_review'
  if (status === 'generated') return 'generated'
  if (status === 'published') return 'published'
  if (status === 'scheduled' || status === 'pending_schedule') return 'scheduled'
  if (status === 'canceled') return 'canceled'
  return 'generated'
}
function socialChannels(pack) {
  const channels = []
  if (pack?.linkedin) channels.push('linkedin')
  if (pack?.x) channels.push('x')
  if (pack?.substackBody || pack?.substackTitle) channels.push('substack')
  if (pack?.videoScript) channels.push('video')
  if (pack?.instagramCarousel || pack?.instagramSlides || pack?.instagramCaption) channels.push('instagram')
  return channels
}

function brandManifest(handle) {
  const directory = join(dataDir, 'brand', handle)
  if (!existsSync(directory)) return {}
  const manifest = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(directory, entry.name)
    if (/\.(?:md|json)$/i.test(entry.name)) {
      const content = readFileSync(file, 'utf8')
      manifest[entry.name] = entry.name.endsWith('.json') ? (() => { try { return JSON.parse(content) } catch { return {} } })() : content
    }
  }
  return manifest
}

function brandAssetFiles(handle) {
  const root = join(dataDir, 'brand', handle)
  if (!existsSync(root)) return []
  const output = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && /\.(?:png|jpe?g|webp|gif|svg)$/i.test(entry.name)) output.push(file)
    }
  }
  walk(root)
  return output
}

function mediaDigest(media) {
  const rawPath = clean(media?.path || media?.url, 1000).replace(/^\/media\//, '')
  const file = join(dataDir, 'media', rawPath.includes('/') ? rawPath : `${clean(media?.site, 120)}/${rawPath}`)
  if (!existsSync(file)) return null
  try { return createHash('sha256').update(readFileSync(file)).digest('hex') } catch { return null }
}

export async function migrateJsonToPostgres({ db = readDb(), users = readJson('users.json', {}).users || [], dryRun = false, backup = true, ifEmpty = false } = {}) {
  const sites = Array.isArray(db.sites) ? db.sites : []
  if (dryRun) return { dryRun: true, counts: { sites: sites.length, posts: (db.posts || []).length, media: (db.media || []).length, users: users.length } }
  const pool = await getPgPool()
  if (!pool) throw Object.assign(new Error('DATABASE_URL es obligatorio para la migración.'), { status: 503 })
  await runCoreMigrations()
  if (ifEmpty) {
    // A fresh Coolify Postgres starts with the schema but no workspace rows.
    // Import only in that case so later restarts never re-read JSON or create
    // a permanent dual-write path.
    const existing = await pool.query(`
      SELECT 1
      FROM workspaces w
      JOIN sites s ON s.workspace_id=w.id
      LIMIT 1
    `)
    if (existing.rowCount) return { dryRun: false, skipped: true, reason: 'postgres_already_initialized' }
  }
  const workspaceId = 'workspace-escarlet'
  const counts = { workspaces: 0, members: 0, users: 0, sites: 0, posts: 0, variants: 0, media: 0, entitlements: 0 }
  const backupInfo = backup ? createMigrationBackup() : null
  await withPgTransaction(pool, async (client) => {
    await client.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,updated_at=NOW()', [workspaceId, sites[0]?.name || 'Escarlet', 'escarlet'])
    counts.workspaces = 1
    const memberIds = new Map()
    const workspaceOwnerId = users.find((user) => ['admin', 'agency_admin'].includes(user.role))?.id || users[0]?.id || 'system'
    for (const user of users) {
      const userId = id(user.id)
      await client.query('INSERT INTO users (id,email,password_hash,password_salt,display_name,bio,avatar_url,disabled,must_set_password,allow_publishing_as,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,updated_at=NOW()', [userId, clean(user.email, 320).toLowerCase(), user.hash || null, user.salt || null, clean(user.displayName, 120), clean(user.bio, 500), user.avatarDataUrl || user.avatarUrl || '', Boolean(user.disabled), Boolean(user.mustSetPassword), Boolean(user.allowPublishingAs), user.createdAt ? isoDate(user.createdAt) : null])
      counts.users++
      const memberId = `member-${workspaceId}-${userId}`
      await client.query('INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,updated_at=NOW()', [memberId, workspaceId, userId, mapRole(user.role)])
      memberIds.set(userId, memberId)
      counts.members++
    }
    if (!memberIds.size) {
      await client.query('INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,user_id) DO NOTHING', [`member-${workspaceId}-system`, workspaceId, 'system', 'owner'])
      memberIds.set('system', `member-${workspaceId}-system`)
      counts.members++
    }
    for (const site of sites) {
      const siteId = id(site.id || site.handle)
      await client.query('INSERT INTO sites (id,workspace_id,handle,name,domain) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,domain=EXCLUDED.domain,updated_at=NOW()', [siteId, workspaceId, clean(site.handle, 120), clean(site.name || site.handle, 200), clean(site.domain, 500) || null])
      counts.sites++
      for (const user of users) {
        const handles = Array.isArray(user.sites) && user.sites.length ? user.sites : user.site ? [user.site] : []
        if (handles.includes(site.handle)) await client.query('INSERT INTO workspace_member_sites (member_id,site_id,role) VALUES ($1,$2,$3) ON CONFLICT (member_id,site_id) DO UPDATE SET role=EXCLUDED.role', [memberIds.get(user.id), siteId, mapRole(user.role)])
      }
      await client.query('INSERT INTO workspace_member_sites (member_id,site_id,role) VALUES ($1,$2,$3) ON CONFLICT (member_id,site_id) DO UPDATE SET role=EXCLUDED.role', [memberIds.get(workspaceOwnerId), siteId, 'owner'])
      if (!users.length) await client.query('INSERT INTO workspace_member_sites (member_id,site_id,role) VALUES ($1,$2,$3) ON CONFLICT (member_id,site_id) DO UPDATE SET role=EXCLUDED.role', [memberIds.get('system'), siteId, 'owner'])
      await client.query('INSERT INTO brand_kits (id,site_id) VALUES ($1,$2) ON CONFLICT (site_id) DO NOTHING', [`brand-${siteId}`, siteId])
      const brandKitId = `brand-${siteId}`
      const versionId = `${brandKitId}-version-1`
      await client.query('INSERT INTO brand_kit_versions (id,brand_kit_id,version,status,manifest,created_by) VALUES ($1,$2,1,\'published\',$3,$4) ON CONFLICT (brand_kit_id,version) DO UPDATE SET manifest=EXCLUDED.manifest,status=EXCLUDED.status', [versionId, brandKitId, json(brandManifest(site.handle)), 'system'])
      await client.query('UPDATE brand_kits SET active_version_id=$1,updated_at=NOW() WHERE id=$2', [versionId, brandKitId])
      const legacyConfig = loadSiteConfig(site.handle) || {}
      const social = legacyConfig.socialPackChannels && typeof legacyConfig.socialPackChannels === 'object' ? legacyConfig.socialPackChannels : {}
      const channels = {
        blog: legacyConfig.contentMode !== 'socialmedia' && legacyConfig.blogEnabled !== false,
        instagram: social.instagramCarousel !== false,
        linkedin: social.linkedin !== false,
        x: social.x !== false,
        video: social.videoScript !== false,
        substack: social.substack !== false
      }
      for (const [channel, enabled] of Object.entries(channels)) {
        await client.query('INSERT INTO site_channels (site_id,channel,enabled,connection_status) VALUES ($1,$2,$3,\'not_connected\') ON CONFLICT (site_id,channel) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW()', [siteId, channel, enabled])
      }
      const capabilities = {
        content_publishing: Object.values(channels).some(Boolean),
        blog_publishing: Boolean(channels.blog),
        presentation_generation: false
      }
      for (const [key, enabled] of Object.entries(capabilities)) {
        await client.query('INSERT INTO brand_capabilities (site_id,key,enabled) VALUES ($1,$2,$3) ON CONFLICT (site_id,key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW()', [siteId, key, enabled])
      }
      if (legacyConfig.domain || legacyConfig.rebuildWebhookUrl || legacyConfig.coolifyApiToken) {
        let encrypted = null
        try { encrypted = legacyConfig.coolifyApiToken ? encryptSecret(legacyConfig.coolifyApiToken) : null } catch { encrypted = null }
        await client.query(`
          INSERT INTO channel_connections (id,workspace_id,site_id,channel,provider,credentials_ciphertext,config,status,is_primary)
          VALUES ($1,$2,$3,'blog','web',$4,$5,'connected',TRUE)
          ON CONFLICT (site_id,channel,provider) DO UPDATE SET credentials_ciphertext=COALESCE(EXCLUDED.credentials_ciphertext,channel_connections.credentials_ciphertext),config=EXCLUDED.config,updated_at=NOW()
        `, [randomUUID(), workspaceId, siteId, encrypted, json({ domain: legacyConfig.domain || null, rebuildWebhookUrl: legacyConfig.rebuildWebhookUrl || null })])
      }
      for (const assetPath of brandAssetFiles(site.handle)) {
        const stat = statSync(assetPath)
        await client.query('INSERT INTO brand_assets (id,brand_kit_version_id,name,storage_key,size_bytes,visibility) VALUES ($1,$2,$3,$4,$5,\'private\') ON CONFLICT (id) DO NOTHING', [`brand-asset-${siteId}-${hash(assetPath).slice(0, 16)}`, versionId, assetPath.split('/').pop(), assetPath, stat.size])
      }
    }
    const posts = Array.isArray(db.posts) ? db.posts : []
    for (const post of posts) {
      const site = sites.find((entry) => entry.handle === post.site) || sites[0]
      if (!site) continue
      const batchId = `legacy-batch-${site.id}-${clean(post.slug, 120)}`
      const itemId = `legacy-item-${site.id}-${clean(post.slug, 120)}`
      const migratedStatus = contentStatus(post.status)
      await client.query('INSERT INTO content_batches (id,workspace_id,site_id,created_by,title,status,total_items,generated_items,metadata) VALUES ($1,$2,$3,$4,$5,$6,1,1,$7) ON CONFLICT (id) DO NOTHING', [batchId, workspaceId, site.id, post.ownerId || workspaceOwnerId, `Migrated: ${post.title || post.slug}`, migratedStatus, json({ legacySlug: post.slug })])
      await client.query('INSERT INTO content_items (id,batch_id,workspace_id,site_id,topic,status,owner_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING', [itemId, batchId, workspaceId, site.id, post.title || post.slug, migratedStatus, post.ownerId || workspaceOwnerId, json({ legacySlug: post.slug })])
      for (const channel of channelsForPost(post)) {
        const body = channel === 'blog' ? { title: post.title, bodyHtml: post.bodyHtml, excerpt: post.excerptEs, slug: post.slug, imageUrl: post.imageUrl } : { text: post.socialPack?.[channel] || post.socialPack?.[channel === 'substack' ? 'substackBody' : channel] || '', title: post.socialPack?.substackTitle || post.title }
        await client.query('INSERT INTO content_variants (id,item_id,workspace_id,channel,status,body) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (item_id,channel) DO NOTHING', [`legacy-variant-${site.id}-${clean(post.slug, 120)}-${channel}`, itemId, workspaceId, channel, migratedStatus, json(body)])
        counts.variants++
      }
      if (post.publishAt && ['scheduled', 'pending_schedule'].includes(post.status)) {
        const legacyDate = new Date(post.publishAt)
        if (Number.isFinite(legacyDate.getTime())) await client.query('INSERT INTO schedules (id,variant_id,publication_date,timezone,status) VALUES ($1,$2,$3,$4,\'scheduled\') ON CONFLICT (variant_id) DO NOTHING', [`legacy-schedule-${site.id}-${clean(post.slug, 120)}`, `legacy-variant-${site.id}-${clean(post.slug, 120)}-blog`, legacyDate.toISOString(), post.timezone || 'UTC'])
      }
      counts.posts++
    }
    for (const pack of (Array.isArray(db.socialPacks) ? db.socialPacks : [])) {
      const site = sites.find((entry) => entry.handle === pack.site) || sites[0]
      if (!site) continue
      const key = clean(pack.id || pack.title || randomUUID(), 120)
      const batchId = `legacy-social-batch-${site.id}-${key}`
      const itemId = `legacy-social-item-${site.id}-${key}`
      const channels = socialChannels(pack.socialPack || pack.channels || pack)
      if (!channels.length) continue
      await client.query('INSERT INTO content_batches (id,workspace_id,site_id,created_by,title,status,total_items,generated_items,metadata) VALUES ($1,$2,$3,$4,$5,\'generated\',1,1,$6) ON CONFLICT (id) DO NOTHING', [batchId, workspaceId, site.id, pack.actorId || workspaceOwnerId, pack.title || 'Migrated Social Pack', json({ legacyId: pack.id || null })])
      await client.query('INSERT INTO content_items (id,batch_id,workspace_id,site_id,topic,status,owner_id,metadata) VALUES ($1,$2,$3,$4,$5,\'generated\',$6,$7) ON CONFLICT (id) DO NOTHING', [itemId, batchId, workspaceId, site.id, pack.title || pack.brief || 'Social Pack', pack.actorId || workspaceOwnerId, json({ legacyId: pack.id || null })])
      for (const channel of channels) {
        const source = pack.socialPack || pack.channels || pack
        const body = { text: source[channel] || source[channel === 'substack' ? 'substackBody' : channel] || '', title: source.substackTitle || pack.title || '' }
        await client.query('INSERT INTO content_variants (id,item_id,workspace_id,channel,status,body) VALUES ($1,$2,$3,$4,\'generated\',$5) ON CONFLICT (item_id,channel) DO NOTHING', [`legacy-social-variant-${site.id}-${key}-${channel}`, itemId, workspaceId, channel, json(body)])
        counts.variants++
      }
    }
    for (const media of (Array.isArray(db.media) ? db.media : [])) {
      const site = sites.find((entry) => entry.handle === media.site) || sites[0]
      if (!site) continue
      const mediaKey = clean(media.path || media.url, 1000)
      await client.query('INSERT INTO media_assets (id,workspace_id,site_id,storage_key,public_url,content_type,size_bytes,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING', [id(media.id, `legacy-media-${hash(`${site.id}:${mediaKey}`).slice(0, 24)}`), workspaceId, site.id, mediaKey, publicMediaUrl(media.url || media.path), clean(media.contentType, 120) || null, Number(media.storedBytes || media.originalBytes) || null, mediaDigest(media), json(media)])
      counts.media++
    }
    // Preserve reusable media links, not only the legacy URL embedded in the
    // blog body. A later batch can reference the same media_asset id.
    for (const post of posts) {
      const site = sites.find((entry) => entry.handle === post.site) || sites[0]
      const imageRef = clean(post.imageUrl || post.imageThumbUrl, 1000)
      const media = (db.media || []).find((entry) => entry.site === site?.handle && imageRef && [entry.url, entry.path, entry.thumbUrl, entry.thumbPath].includes(imageRef))
      if (!site || !media) continue
      const mediaKey = clean(media.path || media.url, 1000)
      const mediaAssetId = id(media.id, `legacy-media-${hash(`${site.id}:${mediaKey}`).slice(0, 24)}`)
      const variantId = `legacy-variant-${site.id}-${clean(post.slug, 120)}-blog`
      await client.query('INSERT INTO content_variant_media (variant_id,media_asset_id,sort_order) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [variantId, mediaAssetId])
    }
    const conversations = db.aiConversations && typeof db.aiConversations === 'object' ? db.aiConversations : {}
    for (const [scopeKey, rawThreads] of Object.entries(conversations)) {
      const threads = Array.isArray(rawThreads) ? rawThreads : rawThreads && typeof rawThreads === 'object' ? Object.values(rawThreads) : []
      for (const thread of threads) {
        if (!thread || typeof thread !== 'object') continue
        const site = sites.find((entry) => entry.handle === thread.site) || sites.find((entry) => scopeKey.startsWith(`${entry.handle}:`)) || sites[0]
        if (!site) continue
        const conversationId = id(thread.id || `legacy-conversation-${hash(`${scopeKey}:${thread.createdAt || thread.updatedAt || randomUUID()}`).slice(0, 24)}`)
        await client.query('INSERT INTO conversations (id,workspace_id,site_id,owner_id,title,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING', [conversationId, workspaceId, site.id, thread.ownerId || scopeKey.split(':').slice(1).join(':') || workspaceOwnerId, clean(thread.title, 300) || null, thread.archived ? 'archived' : 'active', isoDate(thread.createdAt), isoDate(thread.updatedAt)])
        const messages = Array.isArray(thread.messages) ? thread.messages : []
        for (const message of messages.slice(-100)) await client.query('INSERT INTO conversation_messages (id,conversation_id,role,content,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING', [randomUUID(), conversationId, clean(message.role, 30) || 'user', json(message.content || message.text || message), isoDate(message.createdAt)])
      }
    }
    const memberships = db.memberships && typeof db.memberships === 'object' ? db.memberships : {}
    for (const [siteHandle, membership] of Object.entries(memberships)) {
      await client.query('INSERT INTO entitlements (id,workspace_id,key,value,source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()', [`legacy-membership-${siteHandle}`, workspaceId, `membership:${siteHandle}`, json(membership), 'legacy-import'])
      counts.entitlements++
    }
    const plan = Array.isArray(db.plans) ? db.plans.find((entry) => entry.id === memberships[sites[0]?.handle]?.planId) || db.plans[0] : null
    if (plan) {
      for (const [kind, limit] of Object.entries({ content_items_created: plan.draftLimit, publications: plan.publishLimitPerMonth })) {
        if (!Number.isFinite(Number(limit))) continue
        await client.query('INSERT INTO entitlements (id,workspace_id,key,value,source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()', [`legacy-quota-${kind}`, workspaceId, `quota:${kind}`, json({ limit: Number(limit) }), 'legacy-import'])
        counts.entitlements++
      }
    }
    const grants = db.membershipGrants && typeof db.membershipGrants === 'object' ? db.membershipGrants : {}
    for (const [grantKey, grant] of Object.entries(grants)) {
      await client.query('INSERT INTO entitlements (id,workspace_id,key,value,source,expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,source=EXCLUDED.source,expires_at=EXCLUDED.expires_at,updated_at=NOW()', [`legacy-grant-${hash(grantKey).slice(0, 20)}`, workspaceId, `grant:${grantKey}`, json(grant), 'legacy-import', grant?.expiresAt ? isoDate(grant.expiresAt) : null])
      counts.entitlements++
    }
    for (const tokenGroup of ['sessions', 'magic', 'review']) {
      const tokenRecords = readJson('access-tokens.json', {})[tokenGroup] || {}
      for (const [token, record] of Object.entries(tokenRecords)) {
        await client.query('INSERT INTO tokens (id,user_id,workspace_id,token_hash,token_type,expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_hash) DO NOTHING', [randomUUID(), record.userId || null, workspaceId, hash(token), tokenGroup, record.expiresAt ? new Date(record.expiresAt).toISOString() : null])
      }
    }
  })
  return { dryRun: false, backup: backupInfo, counts }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateJsonToPostgres({ dryRun: process.argv.includes('--dry-run'), backup: !process.argv.includes('--no-backup'), ifEmpty: process.argv.includes('--if-empty') }).then((result) => { console.log(JSON.stringify(result, null, 2)); process.exit(0) }).catch((error) => { console.error(error.message); process.exit(1) })
}
