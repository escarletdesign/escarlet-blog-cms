export function blogPublishJobKey(variantId, publicationDate, itemRevision = '') {
  const date = new Date(publicationDate)
  if (!Number.isFinite(date.getTime())) throw new Error('publicationDate inválida.')
  return `blog-publish:${variantId}:${date.toISOString()}${itemRevision === '' ? '' : `:${Number(itemRevision)}`}`
}

// queued/running: el worker ya lo va a publicar. dead_letter: no reintentar en bucle.
export function dueBlogJobAction(jobStatus) {
  if (!jobStatus) return 'enqueue'
  if (jobStatus === 'queued' || jobStatus === 'running' || jobStatus === 'dead_letter') return 'wait'
  return 'requeue'
}
