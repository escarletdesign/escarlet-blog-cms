import { contentPostUrl } from './preview-url.mjs'

const POST_STATUS = Object.freeze({
  draft: 'draft',
  generated: 'ready_for_review',
  needs_review: 'ready_for_review',
  approved: 'approved',
  scheduled: 'scheduled',
  syncing: 'publishing',
  action_required: 'failed',
  published: 'published',
  failed: 'failed',
  canceled: 'archived'
})

export function postStatus(status) {
  return POST_STATUS[String(status || 'draft').toLowerCase()] || 'draft'
}

export function canonicalPost(item = {}) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  const brandOs = metadata.brandOs && typeof metadata.brandOs === 'object' ? metadata.brandOs : {}
  const brandContext = brandOs.brandContext && typeof brandOs.brandContext === 'object' ? brandOs.brandContext : {}
  const campaignMetadata = item.campaignMetadata && typeof item.campaignMetadata === 'object' ? item.campaignMetadata : {}
  const isInbox = campaignMetadata.system === 'inbox' || metadata.system === 'inbox'
  const variants = Array.isArray(item.variants) ? item.variants : []
  return {
    id: item.id,
    brandId: item.site_id || item.siteId || brandContext.site || null,
    campaignId: isInbox ? null : (item.batch_id || item.batchId || null),
    campaignTitle: item.planTitle && !isInbox ? item.planTitle : null,
    title: metadata.contentTitle || item.topic || 'Nueva publicación',
    topic: item.topic || '',
    status: postStatus(item.status),
    brandKitVersionId: brandContext.brandKitVersionId || null,
    generationRunId: metadata.generationRunId || null,
    provenance: {
      source: metadata.source || 'escarlet',
      brandKitVersionId: brandContext.brandKitVersionId || null,
      brandKitSnapshotHash: brandContext.brandKitSnapshotHash || null,
      generationRunId: metadata.generationRunId || null,
      findings: Array.isArray(brandOs.findings) ? brandOs.findings : []
    },
    variants: variants.map((variant) => {
      const variantMetadata = variant.metadata && typeof variant.metadata === 'object' ? variant.metadata : {}
      return {
        id: variant.id,
        postId: item.id,
        channel: variant.channel,
        body: variant.body && typeof variant.body === 'object' ? variant.body : {},
        media: Array.isArray(variant.media) ? variant.media : [],
        status: postStatus(variant.scheduleStatus || variant.status),
        destinationId: variantMetadata.destinationId || null,
        publicationRunId: variantMetadata.publicationRunId || null,
        publicationDate: variant.publicationDate || null,
        scheduleTimezone: variant.scheduleTimezone || null,
        lastError: variant.lastError || null
      }
    }),
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null
  }
}

export function canonicalMutationReferences({ postId = null, variantId = null, brandKitVersionId = null, generationRunId = null, publicationRunId = null, nextAction = null, site = '' } = {}) {
  return { postId, postUrl: contentPostUrl(postId, site), variantId, brandKitVersionId, generationRunId, publicationRunId, nextAction }
}
