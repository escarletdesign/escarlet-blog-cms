import { canViewOwnedDraft, assertAuthorAllowed } from './human-auth.mjs'
import { CmsError } from './cms-ops-errors.mjs'

export function canReadPost(post, auth, site = post?.site) {
  return Boolean(post && (post.status === 'published' || canEditPost(post, auth, site)))
}
export function canEditPost(post, auth, site = post?.site) {
  if (post && !auth?.userId && ['site', 'client'].includes(auth?.role) && !post.ownerId && !post.createdBy && !post.authorId) return true
  return Boolean(post && canViewOwnedDraft({ site, ownerId: post.ownerId || post.createdBy || post.authorId,
    requesterId: auth?.userId, requesterRole: auth?.role }))
}
export function assertPostAccess(post, auth, { write = false } = {}) {
  if (!(write ? canEditPost(post, auth) : canReadPost(post, auth))) throw new CmsError(403, 'No tienes acceso a este post.')
}

// No ownership/status injection through an update, even from an old connector.
export function safePostFields(input, auth, site) {
  const allowed = ['title', 'slug', 'originalSlug', 'bodyHtml', 'excerpt', 'description', 'metaDescription', 'seoTitle',
    'author', 'authorName', 'authorUrl', 'image', 'imageUrl', 'imageAlt', 'imageGallery', 'socialPack', 'tags', 'category', 'relatedSlugs', 'canonicalUrl',
    'excerptEs', 'excerptEn', 'metaTitle', 'metaKeywords', 'heroImage', 'heroImageAlt', 'coverImage', 'coverImageAlt']
  const fields = Object.fromEntries(allowed.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]))
  if (fields.author || fields.authorName) assertAuthorAllowed({ site, authorName: fields.author || fields.authorName, requesterId: auth?.userId, requesterRole: auth?.role })
  return fields
}
