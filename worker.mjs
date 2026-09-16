import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { getPgPool, runCoreMigrations, closePgPool } from './lib/pg.mjs'
import { claimJobs, finishJob, claimOutbox, finishOutbox, recordUsage, enqueueJob } from './lib/workspace-domain.mjs'
import { decryptSecret } from './lib/secret-crypto.mjs'
import { scheduleMetricoolPost, syncMetricoolPost } from './lib/metricool.mjs'
import { schedulePlanablePost, syncPlanablePost, planableStatus } from './lib/planable.mjs'
import { schedulePostizPost, syncPostizPost, postizPostId, postizProviderForChannel, postizStatus } from './lib/postiz.mjs'

function loadEnv() {
  const path = new URL('./.env', import.meta.url)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}
loadEnv()

const workerId = `worker-${process.pid}-${randomUUID()}`
const pollMs = Math.max(Number(process.env.WORKER_POLL_MS || 5000), 500)
const maxAttempts = Math.max(Number(process.env.WORKER_MAX_ATTEMPTS || 5), 1)
const metricoolPollMs = Math.min(Math.max(Number(process.env.METRICOOL_POLL_MS || 300000), 60000), 86400000)
let stopping = false

const retryAt = (attempts) => new Date(Date.now() + Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, attempts - 1))).toISOString()

async function processGenerationJob(job) {
  const pool = await getPgPool()
  const batchId = job.payload?.batchId
  if (!pool || !batchId) throw new Error('content.generate_batch requiere batchId.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const batch = await client.query('SELECT * FROM content_batches WHERE id=$1 FOR UPDATE', [batchId])
    if (!batch.rowCount) throw new Error('Batch no encontrado.')
    const items = await client.query('SELECT id,topic FROM content_items WHERE batch_id=$1 ORDER BY created_at', [batchId])
    for (const item of items.rows) {
      await client.query(`UPDATE content_items SET status='generated',error=NULL,updated_at=NOW() WHERE id=$1 AND status IN ('draft','failed')`, [item.id])
      await client.query(`UPDATE content_variants SET status='generated',body=CASE
        WHEN body='{}'::jsonb OR body->>'topic' IS NOT NULL THEN
          CASE WHEN channel='blog' THEN jsonb_build_object('topic',$2::text,'title',$2::text,'body','Borrador generado. Revisar y editar antes de aprobar.')
          ELSE jsonb_build_object('topic',$2::text,'text','Borrador generado para ' || channel || '. Revisar y editar antes de aprobar.') END
        ELSE body END,updated_at=NOW() WHERE item_id=$1 AND status IN ('draft','failed')`, [item.id, item.topic])
    }
    const counts = await client.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='generated')::int AS generated, COUNT(*) FILTER (WHERE status='failed')::int AS failed FROM content_items WHERE batch_id=$1`, [batchId])
    await client.query(`UPDATE content_batches SET status=CASE WHEN status='canceled' THEN 'canceled' ELSE 'generated' END,total_items=$1,generated_items=$2,failed_items=$3,updated_at=NOW() WHERE id=$4`, [counts.rows[0].total, counts.rows[0].generated, counts.rows[0].failed, batchId])
    await client.query('COMMIT')
    return { generated: items.rows.length, batchId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function processBlogPublishJob(job) {
  const pool = await getPgPool()
  const variantId = job.payload?.variantId
  if (!pool || !variantId) throw new Error('content.publish_blog requiere variantId.')
  const due = await pool.query(`SELECT cv.id,cv.item_id FROM content_variants cv
    WHERE cv.id=$1 AND cv.channel='blog' AND cv.status='scheduled'
      AND EXISTS (SELECT 1 FROM schedules s WHERE s.variant_id=cv.id AND s.publication_date<=NOW())`, [variantId])
  if (!due.rowCount) return { published: false, variantId }
  await recordUsage({ workspaceId: job.workspace_id, kind: 'publications', quantity: 1, idempotencyKey: `publication:${job.id}:${variantId}`, metadata: { variantId, channel: 'blog', provider: 'cms' } })
  const result = await pool.query(`UPDATE content_variants SET status='published',updated_at=NOW() WHERE id=$1 AND status='scheduled' RETURNING id,item_id`, [variantId])
  if (!result.rowCount) return { published: false, variantId }
  await pool.query("UPDATE schedules SET status='published',updated_at=NOW() WHERE variant_id=$1", [variantId])
  await pool.query(`UPDATE content_items ci SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status NOT IN ('published','canceled')) THEN 'published' ELSE ci.status END,updated_at=NOW() WHERE ci.id=$1`, [result.rows[0].item_id])
  return { published: true, variantId }
}

async function processExternalPublicationEvent(event) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const itemId = event.payload?.itemId || event.aggregate_id
  const variants = await pool.query(`SELECT cv.id,cv.channel,cv.body,ci.site_id, s.publication_date,s.timezone,s.provider_post_id,
      cc.provider AS connection_provider,cc.credentials_ciphertext AS connection_credentials_ciphertext,cc.external_account_id AS connection_external_account_id,cc.config AS connection_config,
      mi.user_token_ciphertext,mi.metricool_user_id,mi.blog_id,mi.timezone AS integration_timezone
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id LEFT JOIN schedules s ON s.variant_id=cv.id
    LEFT JOIN LATERAL (SELECT provider,credentials_ciphertext,external_account_id,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND channel=cv.channel AND status='connected' ORDER BY is_primary DESC,updated_at DESC LIMIT 1) cc ON TRUE
    LEFT JOIN LATERAL (SELECT user_token_ciphertext,metricool_user_id,blog_id,timezone FROM metricool_integrations WHERE workspace_id=cv.workspace_id AND (site_id=ci.site_id OR site_id IS NULL) AND enabled=TRUE ORDER BY CASE WHEN site_id=ci.site_id THEN 0 ELSE 1 END LIMIT 1) mi ON TRUE
    WHERE ci.id=$1 AND ci.workspace_id=$2 AND cv.status<>'canceled'`, [itemId, event.workspace_id])
  if (event.type === 'content.item.approved' && variants.rows.every((variant) => !variant.publication_date)) return
  for (const variant of variants.rows) {
    // Blog remains a first-class channel. Keep the legacy CMS/webhook path for
    // existing web connections, but allow Postiz's WordPress integration to
    // execute it like any other provider when explicitly configured.
    const configuredProvider = String(variant.connection_provider || '').toLowerCase()
    if (variant.channel === 'blog' && configuredProvider !== 'postiz') {
      const publicationDate = variant.publication_date ? new Date(variant.publication_date) : null
      if (publicationDate && publicationDate.getTime() > Date.now()) {
        await enqueueJob({ workspaceId: event.workspace_id, type: 'content.publish_blog', payload: { variantId: variant.id }, idempotencyKey: `blog-publish:${variant.id}:${publicationDate.toISOString()}`, availableAt: publicationDate })
      } else {
        await recordUsage({ workspaceId: event.workspace_id, siteId: variant.site_id, kind: 'publications', quantity: 1, idempotencyKey: `publication:${event.id}:${variant.id}`, metadata: { itemId, channel: 'blog', provider: 'cms' } })
        await pool.query(`UPDATE content_variants SET status='published',updated_at=NOW() WHERE id=$1`, [variant.id])
        await pool.query(`UPDATE schedules SET status='published',updated_at=NOW() WHERE variant_id=$1`, [variant.id])
      }
      continue
    }
    const provider = String(variant.connection_provider || 'metricool').toLowerCase()
    const connectionConfig = variant.connection_config && typeof variant.connection_config === 'object' ? variant.connection_config : {}
    const token = decryptSecret(variant.connection_credentials_ciphertext || variant.user_token_ciphertext)
    if (!token) throw new Error(`${provider} no está configurado para la marca.`)
    const body = variant.body && typeof variant.body === 'object' ? variant.body : {}
    const text = body.text || body.caption || body.body || body.bodyHtml || body.title || body.topic || ''
    const mediaRows = await pool.query('SELECT ma.public_url AS "url",ma.metadata FROM content_variant_media cvm JOIN media_assets ma ON ma.id=cvm.media_asset_id WHERE cvm.variant_id=$1 ORDER BY cvm.sort_order', [variant.id])
    await recordUsage({ workspaceId: event.workspace_id, siteId: variant.site_id, kind: 'publications', quantity: 1, idempotencyKey: `publication:${event.id}:${variant.id}`, metadata: { itemId, channel: variant.channel, provider } })
    let response
    if (provider === 'metricool') {
      if (!variant.connection_credentials_ciphertext && (!variant.metricool_user_id || !variant.blog_id)) throw new Error('Metricool no está configurado para la marca.')
      response = variant.provider_post_id
        ? await syncMetricoolPost({ userToken: token, userId: variant.metricool_user_id || variant.connection_external_account_id, blogId: variant.blog_id || connectionConfig.blogId, providerPostId: variant.provider_post_id })
        : await scheduleMetricoolPost({ userToken: token, userId: variant.metricool_user_id || variant.connection_external_account_id, blogId: variant.blog_id || connectionConfig.blogId, publicationDate: variant.publication_date || new Date().toISOString(), timezone: variant.timezone || variant.integration_timezone || connectionConfig.timezone || 'UTC', text, channel: variant.channel, media: mediaRows.rows.filter((asset) => asset.url), idempotencyKey: `metricool:${variant.id}:${variant.publication_date || 'now'}`, autoPublish: false, draft: true })
    } else if (provider === 'planable') {
      const workspaceId = connectionConfig.workspaceId || connectionConfig.workspace_id
      const pageId = connectionConfig.pageId || connectionConfig.page_id || variant.connection_external_account_id
      response = variant.provider_post_id
        ? await syncPlanablePost({ apiToken: token, providerPostId: variant.provider_post_id, apiBaseUrl: connectionConfig.apiBaseUrl || connectionConfig.api_base_url })
        : await schedulePlanablePost({ apiToken: token, workspaceId, pageId, pageIds: connectionConfig.pageIds || connectionConfig.page_ids, publicationDate: variant.publication_date || new Date().toISOString(), text, media: mediaRows.rows.filter((asset) => asset.url), idempotencyKey: `planable:${variant.id}:${variant.publication_date || 'now'}`, apiBaseUrl: connectionConfig.apiBaseUrl || connectionConfig.api_base_url })
    } else if (provider === 'postiz') {
      const integrationId = connectionConfig.integrationId || connectionConfig.integration_id || variant.connection_external_account_id
      const postType = variant.publication_date ? 'schedule' : 'draft'
      response = variant.provider_post_id
        ? await syncPostizPost({ apiToken: token, providerPostId: variant.provider_post_id, apiBaseUrl: connectionConfig.apiBaseUrl || connectionConfig.api_base_url })
        : await schedulePostizPost({ apiToken: token, integrationId, publicationDate: variant.publication_date || new Date().toISOString(), timezone: variant.timezone || connectionConfig.timezone || 'UTC', text, channel: variant.channel, providerType: connectionConfig.providerType || connectionConfig.provider_type || postizProviderForChannel(variant.channel), providerSettings: connectionConfig.providerSettings || connectionConfig.provider_settings || {}, media: mediaRows.rows.filter((asset) => asset.url), idempotencyKey: `postiz:${variant.id}:${variant.publication_date || 'draft'}`, apiBaseUrl: connectionConfig.apiBaseUrl || connectionConfig.api_base_url, postType })
    } else throw new Error(`El proveedor ${provider} aún no tiene un adaptador de publicación.`)
    const providerPostId = provider === 'postiz' ? (postizPostId(response) || variant.provider_post_id || null) : (response?.id || response?.postId || response?.data?.id || response?.posts?.[0]?.id || variant.provider_post_id || null)
    const remoteStatus = provider === 'planable' ? planableStatus(response) : provider === 'postiz' ? postizStatus(response) : String(response?.status || response?.data?.status || '').toLowerCase()
    const status = ['failed', 'error', 'rejected'].includes(remoteStatus) ? 'failed' : remoteStatus === 'published' ? 'published' : provider === 'postiz' && remoteStatus === 'canceled' ? 'canceled' : provider === 'postiz' && remoteStatus === 'scheduled' ? 'scheduled' : 'syncing'
    await pool.query('UPDATE content_variants SET status=$1,updated_at=NOW() WHERE id=$2', [status, variant.id])
    await pool.query('UPDATE schedules SET status=$1,provider=$2,provider_post_id=COALESCE($3,provider_post_id),attempts=attempts+1,last_error=NULL,updated_at=NOW() WHERE variant_id=$4', [status, provider, providerPostId, variant.id])
    if ((status === 'syncing' || (provider === 'postiz' && status === 'scheduled')) && providerPostId) {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: event.workspace_id, type: `${provider}.sync`, payload: { siteId: variant.site_id }, idempotencyKey: `${provider}:poll:${variant.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
    }
  }
  await pool.query(`UPDATE content_items ci SET status=CASE
    WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status='failed') THEN 'failed'
    WHEN NOT EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status NOT IN ('published','canceled')) THEN 'published'
    WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status='syncing') THEN 'syncing'
    ELSE 'scheduled' END,updated_at=NOW() WHERE ci.id=$1`, [itemId])
}

async function processMetricoolSyncJob(job) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const siteId = job.payload?.siteId || null
  const params = [job.workspace_id]
  const siteClause = siteId ? 'AND ci.site_id=$2' : ''
  if (siteId) params.push(siteId)
  const rows = await pool.query(`SELECT cv.id,cv.item_id,cv.channel,ci.site_id,s.provider_post_id,
      COALESCE(cc.credentials_ciphertext,mi.user_token_ciphertext) AS user_token_ciphertext,
      COALESCE(cc.external_account_id,mi.metricool_user_id) AS metricool_user_id,
      COALESCE(cc.config->>'blogId',mi.blog_id) AS blog_id,
      COALESCE(cc.config->>'timezone',mi.timezone) AS integration_timezone
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id
    JOIN schedules s ON s.variant_id=cv.id
    LEFT JOIN LATERAL (SELECT credentials_ciphertext,external_account_id,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND channel=cv.channel AND provider='metricool' AND status='connected' ORDER BY is_primary DESC,updated_at DESC LIMIT 1) cc ON TRUE
    LEFT JOIN LATERAL (SELECT user_token_ciphertext,metricool_user_id,blog_id,timezone FROM metricool_integrations WHERE workspace_id=cv.workspace_id AND (site_id=ci.site_id OR site_id IS NULL) AND enabled=TRUE ORDER BY CASE WHEN site_id=ci.site_id THEN 0 ELSE 1 END LIMIT 1) mi ON TRUE
    WHERE cv.workspace_id=$1 AND s.provider='metricool' AND s.provider_post_id IS NOT NULL AND s.status IN ('scheduled','syncing') ${siteClause}
    ORDER BY s.updated_at ASC LIMIT 100`, params)
  let synced = 0
  for (const row of rows.rows) {
    const token = decryptSecret(row.user_token_ciphertext)
    if (!token) throw new Error('Metricool no está configurado para el sitio.')
    const response = await syncMetricoolPost({ userToken: token, userId: row.metricool_user_id, blogId: row.blog_id, providerPostId: row.provider_post_id })
    const remoteStatus = String(response?.status || response?.data?.status || '').toLowerCase()
    const status = ['failed', 'error', 'rejected'].includes(remoteStatus) ? 'failed' : remoteStatus === 'published' ? 'published' : 'syncing'
    await pool.query('UPDATE content_variants SET status=$1,updated_at=NOW() WHERE id=$2', [status, row.id])
    await pool.query('UPDATE schedules SET status=$1,last_error=NULL,updated_at=NOW() WHERE variant_id=$2', [status, row.id])
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'metricool' } })
    if (status === 'syncing' || status === 'scheduled') {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: job.workspace_id, type: 'metricool.sync', payload: { siteId: row.site_id }, idempotencyKey: `metricool:poll:${row.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
    }
    synced++
  }
  return { synced }
}

async function processPlanableSyncJob(job) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const siteId = job.payload?.siteId || null
  const params = [job.workspace_id]
  const siteClause = siteId ? 'AND ci.site_id=$2' : ''
  if (siteId) params.push(siteId)
  const rows = await pool.query(`SELECT cv.id,cv.item_id,cv.channel,ci.site_id,s.provider_post_id,cc.credentials_ciphertext,cc.config
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id
    JOIN schedules s ON s.variant_id=cv.id
    JOIN LATERAL (SELECT credentials_ciphertext,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND channel=cv.channel AND provider='planable' AND status='connected' ORDER BY is_primary DESC,updated_at DESC LIMIT 1) cc ON TRUE
    WHERE cv.workspace_id=$1 AND s.provider='planable' AND s.provider_post_id IS NOT NULL AND s.status IN ('scheduled','syncing') ${siteClause}
    ORDER BY s.updated_at ASC LIMIT 100`, params)
  let synced = 0
  for (const row of rows.rows) {
    const token = decryptSecret(row.credentials_ciphertext)
    if (!token) throw new Error('Planable no está configurado para la marca.')
    const config = row.config && typeof row.config === 'object' ? row.config : {}
    const response = await syncPlanablePost({ apiToken: token, providerPostId: row.provider_post_id, apiBaseUrl: config.apiBaseUrl || config.api_base_url })
    const remoteStatus = planableStatus(response)
    const status = ['failed', 'error', 'rejected'].includes(remoteStatus) ? 'failed' : remoteStatus === 'published' ? 'published' : 'syncing'
    await pool.query('UPDATE content_variants SET status=$1,updated_at=NOW() WHERE id=$2', [status, row.id])
    await pool.query('UPDATE schedules SET status=$1,last_error=NULL,updated_at=NOW() WHERE variant_id=$2', [status, row.id])
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'planable' } })
    if (status === 'syncing') {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: job.workspace_id, type: 'planable.sync', payload: { siteId: row.site_id }, idempotencyKey: `planable:poll:${row.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
    }
    synced++
  }
  return { synced }
}

async function processPostizSyncJob(job) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const siteId = job.payload?.siteId || null
  const params = [job.workspace_id]
  const siteClause = siteId ? 'AND ci.site_id=$2' : ''
  if (siteId) params.push(siteId)
  const rows = await pool.query(`SELECT cv.id,cv.item_id,cv.channel,ci.site_id,s.provider_post_id,cc.credentials_ciphertext,cc.config
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id
    JOIN schedules s ON s.variant_id=cv.id
    JOIN LATERAL (SELECT credentials_ciphertext,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND channel=cv.channel AND provider='postiz' AND status='connected' ORDER BY is_primary DESC,updated_at DESC LIMIT 1) cc ON TRUE
    WHERE cv.workspace_id=$1 AND s.provider='postiz' AND s.provider_post_id IS NOT NULL AND s.status IN ('scheduled','syncing') ${siteClause}
    ORDER BY s.updated_at ASC LIMIT 100`, params)
  let synced = 0
  for (const row of rows.rows) {
    const token = decryptSecret(row.credentials_ciphertext)
    if (!token) throw new Error('Postiz no está configurado para la marca.')
    const config = row.config && typeof row.config === 'object' ? row.config : {}
    const response = await syncPostizPost({ apiToken: token, providerPostId: row.provider_post_id, apiBaseUrl: config.apiBaseUrl || config.api_base_url })
    const remoteStatus = postizStatus(response)
    const status = remoteStatus === 'failed' ? 'failed' : remoteStatus === 'published' ? 'published' : remoteStatus === 'canceled' ? 'canceled' : remoteStatus === 'draft' || remoteStatus === 'scheduled' ? 'scheduled' : 'syncing'
    await pool.query('UPDATE content_variants SET status=$1,updated_at=NOW() WHERE id=$2', [status, row.id])
    await pool.query('UPDATE schedules SET status=$1,last_error=NULL,updated_at=NOW() WHERE variant_id=$2', [status, row.id])
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'postiz' } })
    if (status === 'syncing') {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: job.workspace_id, type: 'postiz.sync', payload: { siteId: row.site_id }, idempotencyKey: `postiz:poll:${row.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
    }
    synced++
  }
  return { synced }
}

async function processJob(job) {
  if (job.type === 'content.generate_batch') {
    const result = await processGenerationJob(job)
    await recordUsage({ workspaceId: job.workspace_id, kind: 'generations', quantity: result.generated, idempotencyKey: `generation:${result.batchId}`, metadata: { batchId: result.batchId, reserved: true } })
    return result
  }
  if (job.type === 'content.publish_blog') return processBlogPublishJob(job)
  if (job.type === 'metricool.sync') return processMetricoolSyncJob(job)
  if (job.type === 'planable.sync') return processPlanableSyncJob(job)
  if (job.type === 'postiz.sync') return processPostizSyncJob(job)
  throw new Error(`Tipo de job no soportado: ${job.type}`)
}

async function drainOnce() {
  const jobs = await claimJobs({ workerId, limit: 5 })
  for (const job of jobs) {
    try {
      await processJob(job)
      await finishJob(job.id, { ok: true })
    } catch (error) {
      await finishJob(job.id, { ok: false, error: error.message, retryAt: job.attempts >= maxAttempts ? null : retryAt(job.attempts), deadLetter: job.attempts >= maxAttempts })
    }
  }
  const events = await claimOutbox({ workerId, limit: 10 })
  for (const event of events) {
    try {
      if (event.type === 'content.item.approved' || event.type === 'content.item.scheduled') await processExternalPublicationEvent(event)
      await finishOutbox(event.id, { ok: true })
    } catch (error) {
      const pool = await getPgPool()
      const itemId = event.payload?.itemId || event.aggregate_id
      const terminalFailure = event.attempts >= maxAttempts
      const errorMessage = String(error.message || 'External provider error').slice(0, 2000)
      if (pool && itemId && terminalFailure) {
        await pool.query(`UPDATE content_items SET status='failed',error=$1,updated_at=NOW() WHERE id=$2`, [errorMessage, itemId])
        await pool.query(`UPDATE content_variants SET status='failed',updated_at=NOW() WHERE item_id=$1 AND status IN ('scheduled','syncing')`, [itemId])
        await pool.query(`UPDATE schedules SET status='failed',last_error=$1,updated_at=NOW() WHERE variant_id IN (SELECT id FROM content_variants WHERE item_id=$2)`, [errorMessage, itemId])
      }
      await finishOutbox(event.id, { ok: false, error: error.message, retryAt: terminalFailure ? null : retryAt(event.attempts), deadLetter: terminalFailure })
    }
  }
  return jobs.length + events.length
}

export async function startWorker({ once = false } = {}) {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL es obligatorio para el worker.'), { status: 503 })
  await runCoreMigrations()
  do {
    const processed = await drainOnce()
    if (once || stopping) break
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs))
  } while (!stopping)
}

process.once('SIGTERM', () => { stopping = true })
process.once('SIGINT', () => { stopping = true })

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker({ once: process.argv.includes('--once') }).catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(async () => { if (stopping || process.argv.includes('--once')) await closePgPool() })
}
