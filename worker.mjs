import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { getPgPool, runCoreMigrations, closePgPool } from './lib/pg.mjs'
import { claimJobs, finishJob, claimOutbox, finishOutbox, touchJob, touchOutbox, recordUsage, enqueueJob, resolveBufferChannelId } from './lib/workspace-domain.mjs'
import { decryptSecret } from './lib/secret-crypto.mjs'
import { scheduleMetricoolPost, syncMetricoolPost } from './lib/metricool.mjs'
import { schedulePlanablePost, syncPlanablePost, planableStatus } from './lib/planable.mjs'
import { schedulePostizPost, syncPostizPost, postizPostId, postizProviderForChannel, postizStatus } from './lib/postiz.mjs'
import { scheduleBufferPost, syncBufferPost, updateBufferPostDueAt, bufferPostId, bufferStatus } from './lib/buffer.mjs'
import { blogPublicationIsLive, blogPublicationSlug, blogPublicationTitle, blogPublicationUrl } from './lib/blog-publication.mjs'
import { blogPublishJobKey, dueBlogJobAction } from './lib/blog-publish.mjs'
import { fetchRemote } from './lib/remote-fetch.mjs'
import { nextProviderPollAt, providerRowNeedsRemoteSync } from './lib/provider-poll.mjs'
import { ingestVideoUpload, motionRenderAvailability, VIDEO_RENDER_JOB_TYPE } from './lib/video-jobs.mjs'
import { mediaDir } from './lib/db.mjs'
import { renderMotionVideo } from './lib/motion-renderer.mjs'
import { getMotionBrandAssets } from './lib/brand-kit.mjs'

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

async function enqueueBufferStatusPolls(workspaceId, rows, now = Date.now(), quotaExempt = false) {
  const bySite = new Map()
  for (const row of rows || []) {
    const key = row.site_id || ''
    if (!bySite.has(key)) bySite.set(key, [])
    bySite.get(key).push(row)
  }
  for (const [siteId, siteRows] of bySite) {
    const nextPoll = nextProviderPollAt(siteRows, { now, intervalMs: metricoolPollMs })
    if (!nextPoll) continue
    const siteKey = siteId || 'workspace'
    await enqueueJob({
      workspaceId,
      type: 'buffer.sync',
      payload: { siteId: siteId || null, quotaExempt },
      idempotencyKey: `buffer:poll:${workspaceId}:${siteKey}:${Math.floor(nextPoll.getTime() / 60_000)}`,
      availableAt: nextPoll
    })
  }
}

async function triggerBlogRebuild(variant) {
  const config = variant.connection_config && typeof variant.connection_config === 'object' ? variant.connection_config : {}
  const rawUrl = String(config.rebuildWebhookUrl || '').trim()
  if (!rawUrl) throw new Error('El webhook de Coolify no está configurado para el Blog.')
  const url = new URL(rawUrl)
  url.searchParams.set('force', 'true')
  const headers = {}
  const token = decryptSecret(variant.connection_credentials_ciphertext)
  if (token) headers.Authorization = `Bearer ${token}`
  let result = await fetchRemote(url, { method: 'GET', headers, maxBytes: 512 * 1024, timeoutMs: 20_000 })
  let response = result.response
  if (response.status === 405) {
    result = await fetchRemote(url, { method: 'POST', headers, maxBytes: 512 * 1024, timeoutMs: 20_000 })
    response = result.response
  }
  if (!response.ok) throw Object.assign(new Error(`Webhook de Coolify falló con HTTP ${response.status}.`), { status: response.status, code: response.status === 429 || response.status >= 500 ? 'provider_transient' : 'provider_rejected' })
}

async function beginBlogPublication({ pool, workspaceId, variant, sourceId, recordPublication = true, failureStatus = 'scheduled', expectedTitle = '', quotaExempt = false }) {
  const publicationUrl = blogPublicationUrl(variant)
  if (!publicationUrl) throw new Error('El Blog necesita un dominio público y un slug antes de publicarse.')
  if (recordPublication) await recordUsage({ workspaceId, siteId: variant.site_id, kind: 'publications', quantity: 1, idempotencyKey: `publication:${sourceId}:${variant.id}`, metadata: { itemId: variant.item_id, channel: 'blog', provider: 'cms' }, quotaExempt })
  await pool.query("UPDATE content_variants SET status='syncing',updated_at=NOW() WHERE id=$1", [variant.id])
  await pool.query("UPDATE schedules SET status='syncing',last_error=NULL,updated_at=NOW() WHERE variant_id=$1", [variant.id])
  try {
    await triggerBlogRebuild(variant)
    await enqueueJob({ workspaceId, type: 'content.verify_blog', payload: { variantId: variant.id, itemRevision: Number(variant.workflow_revision || 0), publicationUrl, expectedTitle }, idempotencyKey: `blog-verify:${variant.id}:${variant.workflow_revision || 0}:${sourceId}`, availableAt: new Date(Date.now() + blogVerifyDelayMs) })
  } catch (error) {
    const ambiguous = Number(error.status) === 429 || Number(error.status) >= 500 || error.code === 'timeout' || error.code === 'provider_transient' || error.name === 'TimeoutError' || error.name === 'AbortError'
    const nextStatus = ambiguous ? 'action_required' : failureStatus
    await pool.query("UPDATE content_variants SET status=$2,updated_at=NOW() WHERE id=$1 AND status='syncing'", [variant.id, nextStatus])
    await pool.query("UPDATE schedules SET status=$2,last_error=$3,updated_at=NOW() WHERE variant_id=$1 AND status='syncing'", [variant.id, nextStatus, String(error.message || error).slice(0, 2000)])
    throw error
  }
}

async function processBlogPublishJob(job) {
  const pool = await getPgPool()
  const variantId = job.payload?.variantId
  if (!pool || !variantId) throw new Error('content.publish_blog requiere variantId.')
  if (job.payload?.itemRevision === undefined || !Number.isInteger(Number(job.payload.itemRevision))) return { published: false, stale: true, variantId }
  const due = await pool.query(`SELECT cv.id,cv.item_id,ci.workflow_revision,ci.site_id,ci.topic,ci.metadata->>'contentTitle' AS content_title,site.domain AS site_domain,cv.body AS blog_body,cc.credentials_ciphertext AS connection_credentials_ciphertext,cc.config AS connection_config FROM content_variants cv
    LEFT JOIN content_items ci ON ci.id=cv.item_id
    LEFT JOIN sites site ON site.id=ci.site_id
    LEFT JOIN LATERAL (SELECT credentials_ciphertext,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND channel='blog' AND status='connected' ORDER BY is_primary DESC,updated_at DESC LIMIT 1) cc ON TRUE
    WHERE cv.id=$1 AND cv.channel='blog' AND cv.status='scheduled' AND ci.workflow_revision=$2
      AND EXISTS (SELECT 1 FROM schedules s WHERE s.variant_id=cv.id AND s.publication_date<=NOW())`, [variantId, job.payload?.itemRevision === undefined ? null : Number(job.payload.itemRevision)])
  if (!due.rowCount) return { published: false, variantId }
  await beginBlogPublication({ pool, workspaceId: job.workspace_id, variant: due.rows[0], sourceId: job.id, expectedTitle: blogPublicationTitle(due.rows[0]), quotaExempt: Boolean(job.payload?.quotaExempt) })
  return { published: false, syncing: true, variantId }
}

async function processBlogVerifyJob(job) {
  const pool = await getPgPool()
  const variantId = job.payload?.variantId
  if (!pool || !variantId) throw new Error('content.verify_blog requiere variantId.')
  if (job.payload?.itemRevision === undefined || !Number.isInteger(Number(job.payload.itemRevision))) return { published: false, stale: true, variantId }
  const result = await pool.query(`SELECT cv.id,cv.item_id,cv.status,s.status AS schedule_status,ci.workflow_revision,ci.topic,ci.metadata->>'contentTitle' AS content_title,site.domain AS site_domain,cv.body AS blog_body
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN sites site ON site.id=ci.site_id JOIN schedules s ON s.variant_id=cv.id
    WHERE cv.id=$1 AND cv.channel='blog'`, [variantId])
  if (!result.rowCount || result.rows[0].schedule_status === 'published') return { published: Boolean(result.rowCount), variantId }
  const publicationUrl = job.payload?.publicationUrl || blogPublicationUrl(result.rows[0])
  const expectedTitle = job.payload?.expectedTitle || blogPublicationTitle(result.rows[0])
  const expectedSlug = blogPublicationSlug(result.rows[0])
  if (job.payload?.itemRevision !== undefined && Number(job.payload.itemRevision) !== Number(result.rows[0].workflow_revision)) {
    return { published: false, stale: true, variantId }
  }
  if (!await blogPublicationIsLive(publicationUrl, { fetchImpl: fetch, expectedMarkers: [expectedTitle, expectedSlug], cacheBust: `${result.rows[0].workflow_revision}-${Date.now()}` })) {
    throw Object.assign(new Error(`El despliegue terminó de solicitarse, pero ${publicationUrl || 'la URL del artículo'} todavía no está visible.`), { retryAt: new Date(Date.now() + blogVerifyDelayMs).toISOString() })
  }
  await pool.query("UPDATE content_variants SET status='published',updated_at=NOW() WHERE id=$1", [variantId])
  await pool.query("UPDATE schedules SET status='published',last_error=NULL,updated_at=NOW() WHERE variant_id=$1", [variantId])
  await pool.query(`UPDATE content_items ci SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM content_variants cv LEFT JOIN schedules s ON s.variant_id=cv.id WHERE cv.item_id=ci.id AND (cv.status NOT IN ('published','canceled') OR COALESCE(s.status,cv.status) NOT IN ('published','canceled'))) THEN 'published' ELSE ci.status END,error=NULL,updated_at=NOW() WHERE ci.id=$1`, [result.rows[0].item_id])
  return { published: true, variantId, publicationUrl }
}

async function reconcileDueBlogJobs() {
  const pool = await getPgPool()
  if (!pool) return 0
  const due = await pool.query(`SELECT cv.id,cv.workspace_id,ci.workflow_revision,s.publication_date
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN schedules s ON s.variant_id=cv.id
    WHERE cv.channel='blog' AND cv.status='scheduled' AND s.status='scheduled' AND s.publication_date<=NOW()
    ORDER BY s.publication_date LIMIT 100`)
  let recovered = 0
  for (const variant of due.rows) {
    const idempotencyKey = blogPublishJobKey(variant.id, variant.publication_date, variant.workflow_revision)
    const existing = await pool.query('SELECT id,status FROM jobs WHERE idempotency_key=$1 LIMIT 1', [idempotencyKey])
    const action = dueBlogJobAction(existing.rows[0]?.status)
    if (action === 'enqueue') {
      await enqueueJob({ workspaceId: variant.workspace_id, type: 'content.publish_blog', payload: { variantId: variant.id, itemRevision: Number(variant.workflow_revision || 0) }, idempotencyKey, availableAt: variant.publication_date })
      recovered++
    } else if (action === 'requeue') {
      await pool.query("UPDATE jobs SET status='queued',attempts=0,available_at=NOW(),last_error=NULL,locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=$1", [existing.rows[0].id])
      recovered++
    }
  }
  if (recovered) console.log(`[worker] recuperados ${recovered} jobs vencidos del Blog`)
  return recovered
}

async function processExternalPublicationEvent(event) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const itemId = event.payload?.itemId || event.aggregate_id
  const variantsResult = await pool.query(`SELECT cv.id,cv.item_id,cv.channel,cv.body,cv.status AS variant_status,ci.workflow_revision AS item_revision,ci.site_id,ci.topic,ci.metadata->>'contentTitle' AS content_title,site.domain AS site_domain,blog.body AS blog_body, s.publication_date,s.timezone,s.provider_post_id,
      cc.provider AS connection_provider,cc.status AS connection_status,cc.credentials_ciphertext AS connection_credentials_ciphertext,cc.external_account_id AS connection_external_account_id,cc.config AS connection_config,
      mi.user_token_ciphertext,mi.metricool_user_id,mi.blog_id,mi.timezone AS integration_timezone
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id JOIN sites site ON site.id=ci.site_id LEFT JOIN schedules s ON s.variant_id=cv.id
    LEFT JOIN LATERAL (SELECT body FROM content_variants WHERE item_id=ci.id AND channel='blog' LIMIT 1) blog ON TRUE
    LEFT JOIN LATERAL (SELECT provider,status,credentials_ciphertext,external_account_id,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND status='connected' AND is_primary=TRUE AND (channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END OR (provider='buffer' AND channel='buffer')) ORDER BY CASE WHEN channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END THEN 0 ELSE 1 END,updated_at DESC LIMIT 1) cc ON TRUE
    LEFT JOIN LATERAL (SELECT user_token_ciphertext,metricool_user_id,blog_id,timezone FROM metricool_integrations WHERE workspace_id=cv.workspace_id AND (site_id=ci.site_id OR site_id IS NULL) AND enabled=TRUE ORDER BY CASE WHEN site_id=ci.site_id THEN 0 ELSE 1 END LIMIT 1) mi ON TRUE
    WHERE ci.id=$1 AND ci.workspace_id=$2 AND cv.status<>'canceled'`, [itemId, event.workspace_id])
  const requestedChannels = new Set(Array.isArray(event.payload?.channels) ? event.payload.channels.map((channel) => String(channel).toLowerCase()) : [])
  const moveChannels = new Set(Array.isArray(event.payload?.moveChannels) ? event.payload.moveChannels.map((channel) => String(channel).toLowerCase()) : [])
  const eventRevision = event.payload?.itemRevision === undefined ? null : Number(event.payload.itemRevision)
  if (eventRevision === null || !Number.isInteger(eventRevision)) return
  const allowedStatuses = event.type === 'content.blog.updated'
    ? ['approved', 'scheduled', 'syncing', 'published']
    : ['approved', 'scheduled', 'syncing']
  const variants = (requestedChannels.size
    ? variantsResult.rows.filter((variant) => requestedChannels.has(String(variant.channel).toLowerCase()))
    : variantsResult.rows).filter((variant) => {
      if (Number(variant.item_revision) !== eventRevision) return false
      if (event.type === 'content.item.approved' && !variant.publication_date) return false
      return allowedStatuses.includes(String(variant.variant_status || '').toLowerCase())
    })
  if (!variants.length) return
  const bufferPending = []
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
        await enqueueJob({ workspaceId: event.workspace_id, type: 'content.publish_blog', payload: { variantId: variant.id, quotaExempt: Boolean(event.payload?.quotaExempt) }, idempotencyKey: `blog-publish:${variant.id}:${publicationDate.toISOString()}`, availableAt: publicationDate })
      } else {
        await beginBlogPublication({ pool, workspaceId: event.workspace_id, variant, sourceId: event.id, recordPublication: event.type !== 'content.blog.updated', failureStatus: event.type === 'content.blog.updated' ? 'published' : 'scheduled', expectedTitle: blogPublicationTitle(variant), quotaExempt: Boolean(event.payload?.quotaExempt) })
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
    if (!movingBuffer) await recordUsage({ workspaceId: event.workspace_id, siteId: variant.site_id, kind: 'publications', quantity: 1, idempotencyKey: `publication:${event.id}:${variant.id}`, metadata: { itemId, channel: variant.channel, provider }, quotaExempt: Boolean(event.payload?.quotaExempt) })
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
      if (provider === 'buffer') bufferPending.push({ site_id: variant.site_id, publication_date: variant.publication_date, status })
      else {
        const nextPoll = new Date(Date.now() + metricoolPollMs)
        await enqueueJob({ workspaceId: event.workspace_id, type: `${provider}.sync`, payload: { siteId: variant.site_id, quotaExempt: Boolean(event.payload?.quotaExempt) }, idempotencyKey: `${provider}:poll:${variant.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
      }
    }
    } catch (error) {
      const message = String(error.message || 'Error de publicación').slice(0, 2000)
      console.error(`[publish] ${variant.channel} ${variant.id}: ${message}`)
      const transient = Number(error.status) === 429 || Number(error.status) >= 500 || error.code === 'timeout' || error.name === 'TimeoutError' || error.name === 'AbortError'
      const state = transient ? 'action_required' : 'failed'
      await pool.query(`UPDATE content_variants SET status=$2,updated_at=NOW() WHERE id=$1 AND status NOT IN ('published','canceled')`, [variant.id, state])
      await pool.query(`UPDATE schedules SET status=$2,last_error=$3,updated_at=NOW() WHERE variant_id=$1 AND status NOT IN ('published','canceled')`, [variant.id, state, message])
    }
  }
  await enqueueBufferStatusPolls(event.workspace_id, bufferPending, Date.now(), Boolean(event.payload?.quotaExempt))
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
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'metricool' }, quotaExempt: Boolean(job.payload?.quotaExempt) })
    if (status === 'syncing' || status === 'scheduled') {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: job.workspace_id, type: 'metricool.sync', payload: { siteId: row.site_id, quotaExempt: Boolean(job.payload?.quotaExempt) }, idempotencyKey: `metricool:poll:${row.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
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
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'planable' }, quotaExempt: Boolean(job.payload?.quotaExempt) })
    if (status === 'syncing') {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: job.workspace_id, type: 'planable.sync', payload: { siteId: row.site_id, quotaExempt: Boolean(job.payload?.quotaExempt) }, idempotencyKey: `planable:poll:${row.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
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
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'postiz' }, quotaExempt: Boolean(job.payload?.quotaExempt) })
    if (status === 'syncing') {
      const nextPoll = new Date(Date.now() + metricoolPollMs)
      await enqueueJob({ workspaceId: job.workspace_id, type: 'postiz.sync', payload: { siteId: row.site_id, quotaExempt: Boolean(job.payload?.quotaExempt) }, idempotencyKey: `postiz:poll:${row.id}:${Math.floor(nextPoll.getTime() / metricoolPollMs)}`, availableAt: nextPoll })
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
  const rows = await pool.query(`SELECT cv.id,cv.item_id,cv.channel,ci.site_id,s.provider_post_id,s.publication_date,s.status,cc.credentials_ciphertext,cc.config
    FROM content_variants cv JOIN content_items ci ON ci.id=cv.item_id
    JOIN schedules s ON s.variant_id=cv.id
    JOIN LATERAL (SELECT credentials_ciphertext,config FROM channel_connections WHERE workspace_id=cv.workspace_id AND site_id=ci.site_id AND provider='buffer' AND status='connected' AND is_primary=TRUE AND (channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END OR channel='buffer') ORDER BY CASE WHEN channel=CASE WHEN cv.channel='instagram_story' THEN 'instagram' ELSE cv.channel END THEN 0 ELSE 1 END,updated_at DESC LIMIT 1) cc ON TRUE
    WHERE cv.workspace_id=$1 AND s.provider='buffer' AND s.provider_post_id IS NOT NULL AND s.status IN ('scheduled','syncing') ${siteClause}
    ORDER BY s.updated_at ASC LIMIT 100`, params)
  const pending = []
  let synced = 0
  const now = Date.now()
  for (const row of rows.rows) {
    if (!providerRowNeedsRemoteSync(row, { now, intervalMs: metricoolPollMs })) {
      pending.push(row)
      continue
    }
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
    await recordUsage({ workspaceId: job.workspace_id, siteId: row.site_id, kind: 'external_syncs', quantity: 1, idempotencyKey: `sync:${job.id}:${row.id}`, metadata: { itemId: row.item_id, channel: row.channel, provider: 'buffer' }, quotaExempt: Boolean(job.payload?.quotaExempt) })
    if (status === 'syncing' || status === 'scheduled') pending.push({ ...row, status })
    synced++
  }
  await enqueueBufferStatusPolls(job.workspace_id, pending, now, Boolean(job.payload?.quotaExempt))
  return { synced }
}

async function processMotionCompositionJob(job) {
  const pool = await getPgPool()
  if (!pool) throw new Error('Postgres no está configurado.')
  const videoJobId = String(job.payload?.videoJobId || '').trim()
  if (!videoJobId) throw new Error(`${VIDEO_RENDER_JOB_TYPE} requiere videoJobId.`)
  const result = await pool.query(`
    SELECT vj.id,vj.workspace_id,vj.site_id,vj.provider,vj.status,vj.metadata,vj.format,vj.topic,vj.content_item_id,vj.source_media_id,
           s.handle AS site_handle,
           source.storage_key AS source_storage_key,source.content_type AS source_content_type,
           audio.storage_key AS audio_storage_key,audio.content_type AS audio_content_type
    FROM video_jobs vj
    JOIN sites s ON s.id=vj.site_id
    LEFT JOIN media_assets source ON source.id=vj.source_media_id
    LEFT JOIN media_assets audio ON audio.id=(vj.metadata->>'audioAssetId')
    WHERE vj.id=$1 AND vj.workspace_id=$2
    LIMIT 1
  `, [videoJobId, job.workspace_id])
  if (!result.rowCount) throw new Error('Video job no encontrado.')
  const video = result.rows[0]
  if (video.status !== 'queued') return { videoJobId, status: video.status, skipped: true }

  const startedAt = new Date().toISOString()
  const claimed = await pool.query(`
    UPDATE video_jobs
    SET status='running',
        metadata=metadata || jsonb_build_object('processing',$3::jsonb),
        updated_at=NOW()
    WHERE id=$1 AND workspace_id=$2 AND status='queued'
    RETURNING id,status,metadata
  `, [videoJobId, job.workspace_id, JSON.stringify({ state: 'running', code: 'local_render_started', retryable: false, provider: video.provider, rendered: false, startedAt })])
  if (!claimed.rowCount) return { videoJobId, status: 'running', skipped: true }
  video.status = 'running'
  video.metadata = claimed.rows[0].metadata

  const motionAssets = Array.isArray(video.metadata?.motionAssets)
    ? video.metadata.motionAssets
    : Array.isArray(video.metadata?.inputs) ? video.metadata.inputs : []
  const motionAssetIds = [...new Set([
    video.source_media_id,
    video.metadata?.audioAssetId,
    video.metadata?.logoAssetId,
    ...motionAssets.map((asset) => asset?.assetId)
  ].filter(Boolean))]
  const motionAssetRows = motionAssetIds.length
    ? await pool.query('SELECT id,storage_key,content_type FROM media_assets WHERE id=ANY($1::text[]) AND workspace_id=$2 AND site_id=$3', [motionAssetIds, video.workspace_id, video.site_id])
    : { rows: [] }
  const mediaById = new Map(motionAssetRows.rows.map((row) => [row.id, row]))
  const brandAssetRows = motionAssetIds.length
    ? await pool.query(`
      SELECT ba.id,ba.storage_key,ba.content_type
      FROM brand_assets ba
      JOIN brand_kit_versions bkv ON bkv.id=ba.brand_kit_version_id AND bkv.status='published'
      JOIN brand_kits bk ON bk.active_version_id=bkv.id
      JOIN sites s ON s.id=bk.site_id
      WHERE ba.id=ANY($1::text[]) AND s.workspace_id=$2 AND s.id=$3
    `, [motionAssetIds, video.workspace_id, video.site_id])
    : { rows: [] }
  brandAssetRows.rows.forEach((row) => mediaById.set(row.id, row))
  const virtualBrandById = new Map(getMotionBrandAssets(video.site_handle).map((asset) => [asset.assetId || asset.id, asset]))
  const assetForRole = (role) => {
    const reference = motionAssets.find((asset) => asset?.role === role)
    return reference ? (mediaById.get(reference.assetId) || virtualBrandById.get(reference.assetId)) : null
  }

  const availability = motionRenderAvailability(video.provider)
  if (availability.provider === 'local' && availability.configured) {
    const storedPath = (value) => {
      const clean = String(value || '').replace(/^\/+/, '')
      const relative = clean.replace(/^media\//, '')
      const root = resolvePath(mediaDir)
      const candidate = resolvePath(join(root, relative))
      return candidate === root || candidate.startsWith(`${root}/`) ? candidate : ''
    }
    try {
      const background = assetForRole('background') || assetForRole('source') || mediaById.get(video.source_media_id)
      const audio = assetForRole('audio') || mediaById.get(video.metadata?.audioAssetId)
      const logo = assetForRole('logo') || mediaById.get(video.metadata?.logoAssetId)
      const sourcePath = storedPath(background?.storage_key || video.source_storage_key)
      const audioPath = storedPath(audio?.storage_key || video.audio_storage_key)
      const logoPath = storedPath(logo?.storage_key || logo?.path)
      const firstCopy = Array.isArray(video.metadata?.copyBlocks) ? video.metadata.copyBlocks[0] : null
      const buffer = await renderMotionVideo({
        sourcePath,
        audioPath,
        logoPath,
        site: video.site_handle,
        title: firstCopy?.headline || video.topic || video.metadata?.title || 'Reel de marca',
        text: firstCopy?.body || video.metadata?.text || video.topic || '',
        durationSeconds: video.metadata?.durationSeconds || 8
      })
      const currentStatus = await pool.query('SELECT status FROM video_jobs WHERE id=$1 AND workspace_id=$2', [video.id, video.workspace_id])
      if (currentStatus.rows[0]?.status !== 'running') return { videoJobId, status: currentStatus.rows[0]?.status || 'cancelled', skipped: true }
      const uploaded = await ingestVideoUpload({
        workspaceId: video.workspace_id,
        siteId: video.site_id,
        siteHandle: video.site_handle,
        userId: null,
        role: 'editor',
        payload: { buffer, filename: `escarlet-${video.id}.mp4`, mimeType: 'video/mp4' },
        mediaRole: 'final_video',
        format: video.format === 'landscape' ? 'landscape' : 'portrait',
        contentItemId: video.content_item_id,
        videoJobId: video.id
      })
      const processing = { state: 'ready_for_review', code: 'local_renderer_completed', retryable: false, provider: 'local', rendered: true, mediaAssetId: uploaded.mediaAssetId, updatedAt: new Date().toISOString() }
      await pool.query('UPDATE video_jobs SET metadata=metadata || jsonb_build_object(\'processing\',$3::jsonb),updated_at=NOW() WHERE id=$1 AND workspace_id=$2', [video.id, video.workspace_id, JSON.stringify(processing)])
      return { videoJobId, status: 'ready_for_review', provider: 'local', rendered: true, mediaAssetId: uploaded.mediaAssetId, retryable: false, code: 'local_renderer_completed' }
    } catch (error) {
      const processing = { state: 'failed', code: error.code || 'local_renderer_failed', retryable: true, provider: 'local', rendered: false, message: String(error.message || '').slice(0, 500), updatedAt: new Date().toISOString() }
      await pool.query("UPDATE video_jobs SET status='failed',metadata=metadata || jsonb_build_object('processing',$3::jsonb),updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [video.id, video.workspace_id, JSON.stringify(processing)])
      return { videoJobId, status: 'failed', provider: 'local', rendered: false, retryable: true, code: processing.code, error: processing.message }
    }
  }
  const processing = {
    state: availability.status,
    code: availability.code,
    retryable: availability.retryable,
    provider: availability.provider,
    rendered: false,
    updatedAt: new Date().toISOString()
  }
  const updated = await pool.query(`
    UPDATE video_jobs
    SET status='awaiting_provider',
        metadata=metadata || jsonb_build_object('processing',$3::jsonb),
        updated_at=NOW()
    WHERE id=$1 AND workspace_id=$2 AND status='queued'
    RETURNING id,status,provider
  `, [videoJobId, job.workspace_id, JSON.stringify(processing)])
  if (updated.rowCount) {
    await pool.query(`
      INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata)
      VALUES ($1,$2,NULL,$3,$4,$5,$6)
    `, [job.workspace_id, video.site_id, 'video.render_waiting_provider', 'video_job', videoJobId, JSON.stringify(processing)])
  }
  return {
    videoJobId,
    status: updated.rows[0]?.status || 'awaiting_provider',
    provider: updated.rows[0]?.provider || availability.provider,
    rendered: false,
    retryable: availability.retryable,
    code: availability.code
  }
}

async function processJob(job) {
  if (job.type === 'content.publish_blog') return processBlogPublishJob(job)
  if (job.type === 'content.verify_blog') return processBlogVerifyJob(job)
  if (job.type === 'metricool.sync') return processMetricoolSyncJob(job)
  if (job.type === 'planable.sync') return processPlanableSyncJob(job)
  if (job.type === 'postiz.sync') return processPostizSyncJob(job)
  if (job.type === 'buffer.sync') return processBufferSyncJob(job)
  if (job.type === VIDEO_RENDER_JOB_TYPE) return processMotionCompositionJob(job)
  throw new Error(`Tipo de job no soportado: ${job.type}`)
}

async function drainOnce() {
  await reconcileDueBlogJobs()
  const jobs = await claimJobs({ workerId, limit: 5 })
  for (const job of jobs) {
    const leaseTimer = setInterval(() => { void touchJob(job.id, { workerId }).catch(() => {}) }, Math.max(30_000, Number(process.env.WORKER_LEASE_MS || 600_000) / 3))
    try {
      const lease = await touchJob(job.id, { workerId })
      if (lease.leaseLost) continue
      await processJob(job)
      await finishJob(job.id, { workerId, ok: true })
    } catch (error) {
      if (job.type === VIDEO_RENDER_JOB_TYPE && job.payload?.videoJobId) {
        const pool = await getPgPool()
        if (pool) {
          const message = String(error.message || 'El worker no pudo procesar el render.').slice(0, 500)
          const processing = { state: 'failed', code: error.code || 'worker_motion_failed', retryable: true, provider: 'local', rendered: false, message, updatedAt: new Date().toISOString() }
          await pool.query("UPDATE video_jobs SET status='failed',metadata=metadata || jsonb_build_object('processing',$3::jsonb),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','running','rendering')", [job.payload.videoJobId, job.workspace_id, JSON.stringify(processing)]).catch((recordError) => console.error('[worker] no se pudo registrar el fallo de motion', recordError.message))
        }
      }
      const deadLetter = job.attempts >= (job.type === 'content.verify_blog' ? blogVerifyAttempts : maxAttempts)
      await finishJob(job.id, { workerId, ok: false, error: error.message, retryAt: deadLetter ? null : (error.retryAt || retryAt(job.attempts)), deadLetter })
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
    } finally {
      clearInterval(leaseTimer)
    }
  }
  const events = await claimOutbox({ workerId, limit: 10 })
  for (const event of events) {
    const leaseTimer = setInterval(() => { void touchOutbox(event.id, { workerId }).catch(() => {}) }, Math.max(30_000, Number(process.env.WORKER_LEASE_MS || 600_000) / 3))
    try {
      const lease = await touchOutbox(event.id, { workerId })
      if (lease.leaseLost) continue
      if (event.type === 'content.item.approved' || event.type === 'content.item.scheduled' || event.type === 'content.blog.updated') await processExternalPublicationEvent(event)
      await finishOutbox(event.id, { workerId, ok: true })
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
      await finishOutbox(event.id, { workerId, ok: false, error: error.message, retryAt: terminalFailure ? null : retryAt(event.attempts), deadLetter: terminalFailure })
    } finally {
      clearInterval(leaseTimer)
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
