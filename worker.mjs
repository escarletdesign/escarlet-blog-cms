import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { getPgPool, runCoreMigrations, closePgPool } from './lib/pg.mjs'
import { claimJobs, finishJob, claimOutbox, finishOutbox, recordUsage, enqueueJob, resolveBufferChannelId } from './lib/workspace-domain.mjs'
import { decryptSecret } from './lib/secret-crypto.mjs'
import { scheduleMetricoolPost, syncMetricoolPost } from './lib/metricool.mjs'
import { schedulePlanablePost, syncPlanablePost, planableStatus } from './lib/planable.mjs'
import { schedulePostizPost, syncPostizPost, postizPostId, postizProviderForChannel, postizStatus } from './lib/postiz.mjs'
import { scheduleBufferPost, syncBufferPost, updateBufferPostDueAt, bufferPostId, bufferStatus } from './lib/buffer.mjs'
import { blogPublicationIsLive, blogPublicationUrl } from './lib/blog-publication.mjs'

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
const blogVerifyDelayMs = Math.max(Number(process.env.BLOG_VERIFY_DELAY_MS || 20000), 1000)
const blogVerifyAttempts = Math.max(Number(process.env.BLOG_VERIFY_ATTEMPTS || 12), maxAttempts)
let stopping = false

const retryAt = (attempts) => new Date(Date.now() + Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, attempts - 1))).toISOString()

async function triggerBlogRebuild(variant) {
  const config = variant.connection_config && typeof variant.connection_config === 'object' ? variant.connection_config : {}
  const rawUrl = String(config.rebuildWebhookUrl || '').trim()
  if (!rawUrl) throw new Error('El webhook de Coolify no está configurado para el Blog.')
  const url = new URL(rawUrl)
  url.searchParams.set('force', 'true')
  const headers = {}
  const token = decryptSecret(variant.connection_credentials_ciphertext)
  if (token) headers.Authorization = `Bearer ${token}`
  let response = await fetch(url, { method: 'GET', headers })
  if (response.status === 405) response = await fetch(url, { method: 'POST', headers })
  if (!response.ok) throw new Error(`Webhook de Coolify falló con HTTP ${response.status}.`)
}

async function beginBlogPublication({ pool, workspaceId, variant, sourceId }) {
  const publicationUrl = blogPublicationUrl(variant)
  if (!publicationUrl) throw new Error('El Blog necesita un dominio público y un slug antes de publicarse.')
  await recordUsage({ workspaceId, siteId: variant.site_id, kind: 'publications', quantity: 1, idempotencyKey: `publication:${sourceId}:${variant.id}`, metadata: { itemId: variant.item_id, channel: 'blog', provider: 'cms' } })
  await pool.query("UPDATE content_variants SET status='syncing',updated_at=NOW() WHERE id=$1", [variant.id])
  await pool.query("UPDATE schedules SET status='syncing',last_error=NULL,updated_at=NOW() WHERE variant_id=$1", [variant.id])
  try {
    await triggerBlogRebuild(variant)
    await enqueueJob({ workspaceId, type: 'content.verify_blog', payload: { variantId: variant.id, publicationUrl }, idempotencyKey: `blog-verify:${variant.id}:${sourceId}`, availableAt: new Date(Date.now() + blogVerifyDelayMs) })
  } catch (error) {
    await pool.query("UPDATE content_variants SET status='scheduled',updated_at=NOW() WHERE id=$1 AND status='syncing'", [variant.id])
    await pool.query("UPDATE schedules SET status='scheduled',last_error=$2,updated_at=NOW() WHERE variant_id=$1 AND status='syncing'", [variant.id, String(error.message || error).slice(0, 2000)])
    throw error
  }
}

async function processBlogPublishJob(job) {
  const pool = await getPgPool()
  const variantId = job.payload?.variantId
  if (!pool || !variantId) throw new Error('content.publish_blog requiere variantId.')
  const due = await pool.query(`SELECT cv.id,cv.item_id,ci.site_id,ci.topic,ci.metadata->>'contentTitle' AS content_title,site.domain AS site_domain,cv.body AS blog_body,cc.credentials_ciphertext AS connection_credentials_ciphertext,cc.config AS connection_config FROM content_variants cv
    LEFT JOIN content_items ci ON ci.id=cv.item_id
    LEFT JOIN sites site ON site.id=ci.site_id
    LEFT JOIN LATERAL (SELECT credentials_ciphertext,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND channel='blog' AND status='connected' ORDER BY is_primary DESC,updated_at DESC LIMIT 1) cc ON TRUE
    WHERE cv.id=$1 AND cv.channel='blog' AND cv.status='scheduled'
      AND EXISTS (SELECT 1 FROM schedules s WHERE s.variant_id=cv.id AND s.publication_date<=NOW())`, [variantId])
  if (!due.rowCount) return { published: false, variantId }
  await beginBlogPublication({ pool, workspaceId: job.workspace_id, variant: due.rows[0], sourceId: job.id })
  return { published: false, syncing: true, variantId }
}

async function processBlogVerifyJob(job) {
  const pool = await getPgPool()
  const variantId = job.payload?.variantId
  if (!pool || !variantId) throw new Error('content.verify_blog requiere variantId.')
  const result = await pool.query(`SELECT cv.id,cv.item_id,cv.status,s.status AS schedule_status,ci.topic,ci.metadata->>'contentTitle' AS content_title,site.domain AS site_domain,cv.body AS blog_body
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN sites site ON site.id=ci.site_id JOIN schedules s ON s.variant_id=cv.id
    WHERE cv.id=$1 AND cv.channel='blog'`, [variantId])
  if (!result.rowCount || result.rows[0].schedule_status === 'published') return { published: Boolean(result.rowCount), variantId }
  const publicationUrl = job.payload?.publicationUrl || blogPublicationUrl(result.rows[0])
  if (!await blogPublicationIsLive(publicationUrl)) {
    throw Object.assign(new Error(`El despliegue terminó de solicitarse, pero ${publicationUrl || 'la URL del artículo'} todavía no está visible.`), { retryAt: new Date(Date.now() + blogVerifyDelayMs).toISOString() })
  }
  await pool.query("UPDATE content_variants SET status='published',updated_at=NOW() WHERE id=$1", [variantId])
  await pool.query("UPDATE schedules SET status='published',last_error=NULL,updated_at=NOW() WHERE variant_id=$1", [variantId])
  await pool.query(`UPDATE content_items ci SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_variants cv LEFT JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=ci.id AND (cv.status NOT IN ('published','canceled') OR COALESCE(s.status,cv.status) NOT IN ('published','canceled'))) THEN 'published' ELSE ci.status END,error=NULL,updated_at=NOW() WHERE ci.id=$1`, [result.rows[0].item_id])
  return { published: true, variantId, publicationUrl }
}

async function processExternalPublicationEvent(event) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const itemId = event.payload?.itemId || event.aggregate_id
  const variantsResult = await pool.query(`SELECT cv.id,cv.item_id,cv.channel,cv.body,ci.site_id,ci.topic,ci.metadata->>'contentTitle' AS content_title,site.domain AS site_domain,blog.body AS blog_body, s.publication_date,s.timezone,s.provider_post_id,
      cc.provider AS connection_provider,cc.status AS connection_status,cc.credentials_ciphertext AS connection_credentials_ciphertext,cc.external_account_id AS connection_external_account_id,cc.config AS connection_config,
      mi.user_token_ciphertext,mi.metricool_user_id,mi.blog_id,mi.timezone AS integration_timezone
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN sites site ON site.id=ci.site_id LEFT JOIN schedules s ON s.variant_id=cv.id
    LEFT JOIN LATERAL (SELECT body FROM content_variants WHERE item_id=ci.id AND channel='blog' LIMIT 1) blog ON TRUE
    LEFT JOIN LATERAL (SELECT provider,status,credentials_ciphertext,external_account_id,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND status='connected' AND is_primary=TRUE AND (channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END OR (provider='buffer' AND channel='buffer')) ORDER BY CASE WHEN channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END THEN 0 ELSE 1 END,updated_at DESC LIMIT 1) cc ON TRUE
    LEFT JOIN LATERAL (SELECT user_token_ciphertext,metricool_user_id,blog_id,timezone FROM metricool_integrations WHERE workspace_id=cv.workspace_id AND (site_id=ci.site_id OR site_id IS NULL) AND enabled=TRUE ORDER BY CASE WHEN site_id=ci.site_id THEN 0 ELSE 1 END LIMIT 1) mi ON TRUE
    WHERE ci.id=$1 AND ci.workspace_id=$2 AND cv.status<>'canceled'`, [itemId, event.workspace_id])
  const requestedChannels = new Set(Array.isArray(event.payload?.channels) ? event.payload.channels.map((channel) => String(channel).toLowerCase()) : [])
  const moveChannels = new Set(Array.isArray(event.payload?.moveChannels) ? event.payload.moveChannels.map((channel) => String(channel).toLowerCase()) : [])
  const variants = requestedChannels.size
    ? variantsResult.rows.filter((variant) => requestedChannels.has(String(variant.channel).toLowerCase()))
    : variantsResult.rows
  if (event.type === 'content.item.approved' && variants.every((variant) => !variant.publication_date)) return
  for (const variant of variants) {
    try {
    if (variant.channel === 'substack') {
      const message = 'La publicación en Substack está suspendida porque no hay API disponible.'
      await pool.query("UPDATE content_variants SET status='action_required',updated_at=NOW() WHERE id=$1", [variant.id])
      await pool.query("UPDATE schedules SET status='action_required',last_error=$1,updated_at=NOW() WHERE variant_id=$2", [message, variant.id])
      continue
    }
    // Blog remains a first-class channel and always deploys through Coolify.
    if (variant.channel === 'blog') {
      const publicationDate = variant.publication_date ? new Date(variant.publication_date) : null
      if (publicationDate && publicationDate.getTime() > Date.now()) {
        await enqueueJob({ workspaceId: event.workspace_id, type: 'content.publish_blog', payload: { variantId: variant.id }, idempotencyKey: `blog-publish:${variant.id}:${publicationDate.toISOString()}`, availableAt: publicationDate })
      } else {
        await beginBlogPublication({ pool, workspaceId: event.workspace_id, variant, sourceId: event.id })
      }
      continue
    }
    const configuredProvider = String(variant.connection_provider || '').toLowerCase()
    const provider = configuredProvider || (variant.user_token_ciphertext || variant.metricool_user_id ? 'metricool' : '')
    const connectionConfig = variant.connection_config && typeof variant.connection_config === 'object' ? variant.connection_config : {}
    const token = decryptSecret(variant.connection_credentials_ciphertext || variant.user_token_ciphertext)
    if (!provider || !token || (variant.connection_status && variant.connection_status !== 'connected')) {
      const message = `No hay una conexión configurada para ${variant.channel}.`
      await pool.query("UPDATE content_variants SET status='action_required',updated_at=NOW() WHERE id=$1", [variant.id])
      await pool.query("UPDATE schedules SET status='action_required',last_error=$1,updated_at=NOW() WHERE variant_id=$2", [message, variant.id])
      continue
    }
    const body = variant.body && typeof variant.body === 'object' ? variant.body : {}
    const socialPack = body.socialPack && typeof body.socialPack === 'object' ? body.socialPack : {}
    const story = variant.channel === 'instagram_story'
    const publishCopy = typeof body.publishCopy === 'string' ? body.publishCopy.trim() : ''
    const text = publishCopy || (story
      ? socialPack.instagramStory?.text || body.text || body.caption || body.title || body.topic || variant.topic || ''
      : variant.channel === 'video'
        ? socialPack.videoScript || body.videoScript || body.script || body.text || body.title || body.topic || variant.topic || ''
      : socialPack.instagramCaption || socialPack.caption || body.text || body.caption || body.body || body.bodyHtml || body.title || body.topic || '')
    let mediaRows = await pool.query('SELECT ma.public_url AS "url",ma.content_type AS "mimeType",ma.metadata FROM content_variant_media cvm JOIN media_assets ma ON ma.id=cvm.media_asset_id WHERE cvm.variant_id=$1 ORDER BY cvm.sort_order', [variant.id])
    if (story && !mediaRows.rowCount) {
      mediaRows = await pool.query(`SELECT ma.public_url AS "url",ma.content_type AS "mimeType",ma.metadata
        FROM content_variant_media cvm JOIN media_assets ma ON ma.id=cvm.media_asset_id
        JOIN content_variants feed ON feed.id=cvm.variant_id
        WHERE feed.item_id=(SELECT item_id FROM content_variants WHERE id=$1) AND feed.channel='instagram'
        ORDER BY cvm.sort_order`, [variant.id])
    }
    if (story && provider !== 'buffer') {
      const message = 'Instagram Story requiere una conexión Buffer.'
      await pool.query("UPDATE content_variants SET status='action_required',updated_at=NOW() WHERE id=$1", [variant.id])
      await pool.query("UPDATE schedules SET status='action_required',last_error=$1,updated_at=NOW() WHERE variant_id=$2", [message, variant.id])
      continue
    }
    if (story && !mediaRows.rows.some((asset) => asset.url)) {
      const message = 'Instagram Story requiere al menos una imagen pública.'
      await pool.query("UPDATE content_variants SET status='action_required',updated_at=NOW() WHERE id=$1", [variant.id])
      await pool.query("UPDATE schedules SET status='action_required',last_error=$1,updated_at=NOW() WHERE variant_id=$2", [message, variant.id])
      continue
    }
    const movingBuffer = provider === 'buffer' && moveChannels.has(String(variant.channel).toLowerCase()) && variant.provider_post_id
    if (!movingBuffer) await recordUsage({ workspaceId: event.workspace_id, siteId: variant.site_id, kind: 'publications', quantity: 1, idempotencyKey: `publication:${event.id}:${variant.id}`, metadata: { itemId, channel: variant.channel, provider } })
    let response
    if (provider === 'metricool') {
      if (!variant.connection_credentials_ciphertext && (!variant.metricool_user_id || !variant.blog_id)) {
        const message = 'Metricool no está configurado para la marca.'
        await pool.query("UPDATE content_variants SET status='action_required',updated_at=NOW() WHERE id=$1", [variant.id])
        await pool.query("UPDATE schedules SET status='action_required',last_error=$1,updated_at=NOW() WHERE variant_id=$2", [message, variant.id])
        continue
      }
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
    } else if (provider === 'buffer') {
      const organizationId = connectionConfig.organizationId || connectionConfig.organization_id
      const channelId = resolveBufferChannelId(connectionConfig, variant.channel, variant.connection_external_account_id)
      if (!channelId) throw new Error(`No hay un canal de Buffer configurado para ${variant.channel}.`)
      const postType = variant.publication_date ? 'schedule' : 'draft'
      response = movingBuffer
        ? await updateBufferPostDueAt({ apiToken: token, providerPostId: variant.provider_post_id, publicationDate: variant.publication_date, idempotencyKey: `buffer-move:${variant.id}:${event.id}` })
        : variant.provider_post_id
          ? await syncBufferPost({ apiToken: token, providerPostId: variant.provider_post_id })
          : await scheduleBufferPost({ apiToken: token, organizationId, channelId, publicationDate: variant.publication_date || null, text, media: mediaRows.rows.filter((asset) => asset.url), idempotencyKey: `buffer:${variant.id}:${variant.publication_date || 'draft'}:${event.id}`, postType, service: variant.channel, linkUrl: story ? (socialPack.instagramStory?.linkUrl || blogPublicationUrl(variant)) : '' })
    } else throw new Error(`El proveedor ${provider} aún no tiene un adaptador de publicación.`)
    const providerPostId = provider === 'postiz' ? (postizPostId(response) || variant.provider_post_id || null) : provider === 'buffer' ? (bufferPostId(response) || variant.provider_post_id || null) : (response?.id || response?.postId || response?.data?.id || response?.posts?.[0]?.id || variant.provider_post_id || null)
    const remoteStatus = provider === 'planable' ? planableStatus(response) : provider === 'postiz' ? postizStatus(response) : provider === 'buffer' ? bufferStatus(response) : String(response?.status || response?.data?.status || '').toLowerCase()
    const status = provider === 'buffer' && story && remoteStatus === 'published' ? 'action_required' : ['failed', 'error', 'rejected'].includes(remoteStatus) ? 'failed' : remoteStatus === 'published' ? 'published' : ['postiz', 'buffer'].includes(provider) && remoteStatus === 'canceled' ? 'canceled' : ['postiz', 'buffer'].includes(provider) && (remoteStatus === 'scheduled' || remoteStatus === 'draft') ? 'scheduled' : 'syncing'
    await pool.query('UPDATE content_variants SET status=$1,updated_at=NOW() WHERE id=$2', [status, variant.id])
    await pool.query('UPDATE schedules SET status=$1,provider=$2,provider_post_id=COALESCE($3,provider_post_id),attempts=attempts+1,last_error=NULL,updated_at=NOW() WHERE variant_id=$4', [status, provider, providerPostId, variant.id])
    if ((status === 'syncing' || (['postiz', 'buffer'].includes(provider) && status === 'scheduled')) && providerPostId) {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: event.workspace_id, type: `${provider}.sync`, payload: { siteId: variant.site_id }, idempotencyKey: `${provider}:poll:${variant.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
    }
    } catch (error) {
      const message = String(error.message || 'Error de publicación').slice(0, 2000)
      console.error(`[publish] ${variant.channel} ${variant.id}: ${message}`)
      await pool.query(`UPDATE content_variants SET status='failed',updated_at=NOW() WHERE id=$1 AND status NOT IN ('published','canceled')`, [variant.id])
      await pool.query(`UPDATE schedules SET status='failed',last_error=$2,updated_at=NOW() WHERE variant_id=$1 AND status NOT IN ('published','canceled')`, [variant.id, message])
    }
  }
  await pool.query(`UPDATE content_items ci SET status=CASE
    WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status='scheduled') THEN 'scheduled'
    WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status='failed') THEN 'failed'
    WHEN NOT EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status NOT IN ('published','canceled')) THEN 'published'
    WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status='action_required') THEN 'action_required'
    WHEN EXISTS (SELECT 1 FROM content_variants cv WHERE cv.item_id=ci.id AND cv.status='syncing') THEN 'syncing'
  ELSE ci.status END,
  error=(SELECT string_agg(cv.channel || ': ' || s.last_error, chr(10) ORDER BY cv.channel) FROM content_variants cv JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=ci.id AND s.last_error IS NOT NULL),
  updated_at=NOW() WHERE ci.id=$1`, [itemId])
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
    const status = row.channel === 'instagram_story' && remoteStatus === 'published' ? 'action_required' : remoteStatus === 'failed' ? 'failed' : remoteStatus === 'published' ? 'published' : remoteStatus === 'canceled' ? 'canceled' : remoteStatus === 'draft' || remoteStatus === 'scheduled' ? 'scheduled' : 'syncing'
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

async function processBufferSyncJob(job) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const siteId = job.payload?.siteId || null
  const params = [job.workspace_id]
  const siteClause = siteId ? 'AND ci.site_id=$2' : ''
  if (siteId) params.push(siteId)
  const rows = await pool.query(`SELECT cv.id,cv.item_id,cv.channel,ci.site_id,s.provider_post_id,cc.credentials_ciphertext,cc.config
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id
    JOIN schedules s ON s.variant_id=cv.id
    JOIN LATERAL (SELECT credentials_ciphertext,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND provider='buffer' AND status='connected' AND is_primary=TRUE AND (channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END OR channel='buffer') ORDER BY CASE WHEN channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END THEN 0 ELSE 1 END,updated_at DESC LIMIT 1) cc ON TRUE
    WHERE cv.workspace_id=$1 AND s.provider='buffer' AND s.provider_post_id IS NOT NULL AND s.status IN ('scheduled','syncing') ${siteClause}
    ORDER BY s.updated_at ASC LIMIT 100`, params)
  let synced = 0
  for (const row of rows.rows) {
    const token = decryptSecret(row.credentials_ciphertext)
    if (!token) throw new Error('Buffer no está configurado para la marca.')
    const config = row.config && typeof row.config === 'object' ? row.config : {}
    const response = await syncBufferPost({ apiToken: token, providerPostId: row.provider_post_id, apiBaseUrl: config.apiBaseUrl || config.api_base_url })
    const remoteStatus = bufferStatus(response)
    const status = row.channel === 'instagram_story' && remoteStatus === 'published'
      ? 'action_required'
      : remoteStatus === 'failed'
        ? 'failed'
        : remoteStatus === 'published'
          ? 'published'
          : remoteStatus === 'canceled'
            ? 'canceled'
            : remoteStatus === 'draft' || remoteStatus === 'scheduled' ? 'scheduled' : 'syncing'
    await pool.query('UPDATE content_variants SET status=$1,updated_at=NOW() WHERE id=$2', [status, row.id])
    await pool.query('UPDATE schedules SET status=$1,last_error=NULL,updated_at=NOW() WHERE variant_id=$2', [status, row.id])
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'buffer' } })
    if (status === 'syncing' || status === 'scheduled') {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: job.workspace_id, type: 'buffer.sync', payload: { siteId: row.site_id }, idempotencyKey: `buffer:poll:${row.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
    }
    synced++
  }
  return { synced }
}

async function processJob(job) {
  if (job.type === 'content.publish_blog') return processBlogPublishJob(job)
  if (job.type === 'content.verify_blog') return processBlogVerifyJob(job)
  if (job.type === 'metricool.sync') return processMetricoolSyncJob(job)
  if (job.type === 'planable.sync') return processPlanableSyncJob(job)
  if (job.type === 'postiz.sync') return processPostizSyncJob(job)
  if (job.type === 'buffer.sync') return processBufferSyncJob(job)
  throw new Error(`Tipo de job no soportado: ${job.type}`)
}

async function drainOnce() {
  const jobs = await claimJobs({ workerId, limit: 5 })
  for (const job of jobs) {
    try {
      await processJob(job)
      await finishJob(job.id, { ok: true })
    } catch (error) {
      const deadLetter = job.attempts >= (job.type === 'content.verify_blog' ? blogVerifyAttempts : maxAttempts)
      await finishJob(job.id, { ok: false, error: error.message, retryAt: deadLetter ? null : (error.retryAt || retryAt(job.attempts)), deadLetter })
      if (deadLetter && ['content.publish_blog', 'content.verify_blog'].includes(job.type) && job.payload?.variantId) {
        const pool = await getPgPool()
        const message = String(error.message || 'No se pudo publicar el blog en Coolify.').slice(0, 2000)
        if (pool) {
          if (job.type === 'content.verify_blog') {
            await pool.query(`UPDATE schedules SET status='action_required',last_error=$2,updated_at=NOW() WHERE variant_id=$1 AND status='syncing'`, [job.payload.variantId, message])
            await pool.query(`UPDATE content_items SET status='action_required',error=$2,updated_at=NOW() WHERE id=(SELECT item_id FROM content_variants WHERE id=$1)`, [job.payload.variantId, message])
          } else {
            await pool.query(`UPDATE content_variants SET status='failed',updated_at=NOW() WHERE id=$1 AND status='scheduled'`, [job.payload.variantId])
            await pool.query(`UPDATE schedules SET status='failed',last_error=$2,updated_at=NOW() WHERE variant_id=$1 AND status NOT IN ('published','canceled')`, [job.payload.variantId, message])
            await pool.query(`UPDATE content_items SET status='failed',error=$2,updated_at=NOW() WHERE id=(SELECT item_id FROM content_variants WHERE id=$1)`, [job.payload.variantId, message])
          }
        }
      }
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
      const channels = Array.isArray(event.payload?.channels) ? event.payload.channels.map((channel) => String(channel).toLowerCase()) : []
      if (pool && itemId && terminalFailure && channels.length) {
        await pool.query(`UPDATE content_items SET error=$1,updated_at=NOW() WHERE id=$2`, [errorMessage, itemId])
        await pool.query(`UPDATE content_variants SET status='failed',updated_at=NOW() WHERE item_id=$1 AND channel=ANY($2::text[]) AND status IN ('scheduled','syncing')`, [itemId, channels])
        await pool.query(`UPDATE schedules SET status='failed',last_error=$1,updated_at=NOW() WHERE variant_id IN (SELECT id FROM content_variants WHERE item_id=$2 AND channel=ANY($3::text[])) AND status NOT IN ('published','canceled')`, [errorMessage, itemId, channels])
      }
      await finishOutbox(event.id, { ok: false, error: error.message, retryAt: terminalFailure ? null : retryAt(event.attempts), deadLetter: terminalFailure })
    }
  }
  return jobs.length + events.length
}

export async function startWorker({ once = false } = {}) {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL es obligatorio para el worker.'), { status: 503 })
  let failures = 0
  while (!stopping) {
    try {
      await runCoreMigrations()
      const processed = await drainOnce()
      failures = 0
      if (once || stopping) break
      if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs))
    } catch (error) {
      if (once) throw error
      failures += 1
      const retryMs = Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5))
      console.error(`[worker] ${error.message}; reintento en ${retryMs}ms`)
      await new Promise((resolve) => setTimeout(resolve, retryMs))
    }
  }
}

process.once('SIGTERM', () => { stopping = true })
process.once('SIGINT', () => { stopping = true })

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker({ once: process.argv.includes('--once') }).catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(async () => { if (stopping || process.argv.includes('--once')) await closePgPool() })
}
