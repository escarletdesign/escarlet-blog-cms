/**
 * User-facing workflow switches. These flags are deliberately separate from
 * the temporary billing QA switch so they can be changed without touching
 * payment state or site configuration.
 */

const ASSISTANT_FLAG = 'assistantEnabled'
const BLOG_WIZARD_FLAG = 'blogWizardEnabled'

function store(db) {
  return db?.featureFlags && typeof db.featureFlags === 'object' && !Array.isArray(db.featureFlags)
    ? db.featureFlags
    : {}
}

function text(value) {
  return String(value ?? '').trim()
}

export function getWorkflowFlags(db) {
  const raw = store(db)
  return {
    assistantEnabled: raw[ASSISTANT_FLAG] !== false,
    blogWizardEnabled: raw[BLOG_WIZARD_FLAG] !== false,
    updatedAt: text(raw.updatedAt) || null
  }
}

export function setWorkflowFlags({ db, assistantEnabled, blogWizardEnabled, actorId, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const previous = store(db)
  db.featureFlags = {
    ...previous,
    [ASSISTANT_FLAG]: typeof assistantEnabled === 'boolean' ? assistantEnabled : previous[ASSISTANT_FLAG] !== false,
    [BLOG_WIZARD_FLAG]: typeof blogWizardEnabled === 'boolean' ? blogWizardEnabled : previous[BLOG_WIZARD_FLAG] !== false,
    updatedAt: text(now),
    ...(text(actorId) ? { updatedBy: text(actorId).slice(0, 120) } : {})
  }
  return getWorkflowFlags(db)
}

