import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dataDir, readDb } from '../../lib/db.mjs'
import { getPgPool, runCoreMigrations, withPgTransaction } from '../../lib/pg.mjs'
import { createMigrationBackup, migrateJsonToPostgres } from '../migrate-json-to-postgres.mjs'

const dryRun = process.argv.includes('--dry-run')
const skipBackup = process.argv.includes('--no-backup')
const root = join(dataDir, 'migration-backups', new Date().toISOString().replace(/[:.]/g, '-'))

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function json(value) {
  return JSON.stringify(value && typeof value === 'object' ? value : {})
}

function backupPostgres(destination) {
  const report = { requested: Boolean(process.env.DATABASE_URL), created: false, path: null, error: null }
  if (!process.env.DATABASE_URL) return report
  mkdirSync(destination, { recursive: true })
  const target = join(destination, 'postgres.sql')
  const command = process.env.PG_DUMP_BIN || 'pg_dump'
  const result = spawnSync(command, ['--dbname', process.env.DATABASE_URL, '--file', target, '--no-owner', '--no-privileges'], { encoding: 'utf8' })
  if (result.status === 0 && existsSync(target)) {
    report.created = true
    report.path = target
    report.sha256 = sha256(readFileSync(target))
  } else {
    report.error = text(result.error?.message || result.stderr || `No se pudo ejecutar ${command}.`, 1000)
  }
  return report
}

async function ensureDraftPostsForOrphanAssets() {
  const pool = await getPgPool()
  if (!pool) return { checked: false, created: 0, assets: [], reason: 'postgres_required' }
  await runCoreMigrations()
  return withPgTransaction(pool, async (client) => {
    const result = await client.query(`
      SELECT ma.id,ma.workspace_id AS "workspaceId",ma.site_id AS "siteId",ma.metadata,
             COALESCE(ma.metadata->>'filename', ma.storage_key, ma.id) AS label,
             bk.active_version_id AS "brandKitVersionId"
      FROM media_assets ma
      JOIN sites s ON s.id=ma.site_id
      LEFT JOIN brand_kits bk ON bk.site_id=ma.site_id
      WHERE COALESCE(ma.metadata->>'kind','') IN ('post','social')
        AND NOT EXISTS (SELECT 1 FROM content_variant_media cvm WHERE cvm.media_asset_id=ma.id)
      ORDER BY ma.created_at ASC
    `)
    const created = []
    const inboxBySite = new Map()
    for (const asset of result.rows) {
      let batchId = inboxBySite.get(asset.siteId)
      if (!batchId) {
        const existing = await client.query("SELECT id FROM content_batches WHERE workspace_id=$1 AND site_id=$2 AND metadata->>'system'='inbox' ORDER BY created_at ASC LIMIT 1 FOR UPDATE", [asset.workspaceId, asset.siteId])
        if (existing.rowCount) batchId = existing.rows[0].id
        else {
          batchId = `inbox-${asset.siteId}`
          await client.query(`
            INSERT INTO content_batches (id,workspace_id,site_id,title,status,brand_kit_version_id,total_items,metadata)
            VALUES ($1,$2,$3,'Inbox editorial','draft',$4,0,$5)
            ON CONFLICT (id) DO NOTHING
          `, [batchId, asset.workspaceId, asset.siteId, asset.brandKitVersionId || null, json({ system: 'inbox', hiddenFromCampaignList: true })])
        }
        inboxBySite.set(asset.siteId, batchId)
      }
      const metadata = asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}
      const grounding = metadata.brandGrounding && typeof metadata.brandGrounding === 'object' ? metadata.brandGrounding : {}
      const channel = text(grounding.channels?.[0] || grounding.channel || metadata.channel || (metadata.kind === 'social' ? 'instagram' : 'blog'), 80).toLowerCase()
      const postId = `migration-post-${asset.id}`
      const variantId = `migration-variant-${asset.id}`
      await client.query(`
        INSERT INTO content_items (id,batch_id,workspace_id,site_id,topic,status,metadata)
        VALUES ($1,$2,$3,$4,$5,'draft',$6)
        ON CONFLICT (id) DO NOTHING
      `, [postId, batchId, asset.workspaceId, asset.siteId, text(metadata.title || asset.label || 'Contenido generado'), json({ contentTitle: text(metadata.title || asset.label || 'Contenido generado'), source: 'legacy-migration', migration: { orphanAssetId: asset.id } })])
      await client.query(`
        INSERT INTO content_variants (id,item_id,workspace_id,channel,status,body,metadata)
        VALUES ($1,$2,$3,$4,'draft',$5,$6)
        ON CONFLICT (id) DO NOTHING
      `, [variantId, postId, asset.workspaceId, channel, json({}), json({ source: 'legacy-migration', orphanAsset: true })])
      await client.query('INSERT INTO content_variant_media (variant_id,media_asset_id,sort_order) VALUES ($1,$2,0) ON CONFLICT (variant_id,media_asset_id) DO NOTHING', [variantId, asset.id])
      await client.query("UPDATE media_assets SET metadata=metadata || jsonb_build_object('migrationPostId',$2::text,'orphanResolved',true) WHERE id=$1", [asset.id, postId])
      await client.query('UPDATE content_batches SET total_items=(SELECT COUNT(*) FROM content_items WHERE batch_id=$1),updated_at=NOW() WHERE id=$1', [batchId])
      created.push({ assetId: asset.id, postId, variantId, channel })
    }
    return { checked: true, created: created.length, assets: created }
  })
}

async function main() {
  const db = readDb()
  if (dryRun) {
    const preview = await migrateJsonToPostgres({ db, dryRun: true, backup: false })
    return {
      mode: 'dry-run',
      source: { posts: Array.isArray(db.posts) ? db.posts.length : 0, socialPacks: Array.isArray(db.socialPacks) ? db.socialPacks.length : 0, media: Array.isArray(db.media) ? db.media.length : 0 },
      migration: preview,
      rule: 'Cada asset publicable sin relación se convertirá en un Post borrador en Inbox editorial.'
    }
  }
  const backup = skipBackup ? null : { json: createMigrationBackup({ destination: root }), postgres: backupPostgres(root) }
  const migration = await migrateJsonToPostgres({ db, backup: false, ifEmpty: false })
  const orphanAssets = await ensureDraftPostsForOrphanAssets()
  const report = { version: 'v3', completedAt: new Date().toISOString(), backup, migration, orphanAssets }
  const reportPath = join(backup?.json?.destination || join(dataDir, 'migration-reports'), `v3-${Date.now()}.json`)
  mkdirSync(join(reportPath, '..'), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
  return { ...report, reportPath }
}

main().then((result) => {
  console.log(JSON.stringify(result, null, 2))
}).catch((error) => {
  console.error(JSON.stringify({ code: error.code || 'migration_failed', message: error.message }, null, 2))
  process.exitCode = 1
})
