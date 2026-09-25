/**
 * User-facing workflow switches. These flags are deliberately separate from
 * the temporary billing QA switch so they can be changed without touching
 * payment state or site configuration.
 */

const ASSISTANT_FLAG = 'assistantEnabled'
const BLOG_WIZARD_FLAG = 'blogWizardEnabled'
const PREVIEW_FLAG = 'legacyPreviewEnabled'
const SOCIAL_PACK_FLAG = 'legacySocialPackEnabled'
const AUTHOR_INVITE_FLAG = 'authorInviteEnabled'
const ASSISTANT_BRAND_KIT_FLAG = 'assistantBrandKitToolsEnabled'

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
    legacyPreviewEnabled: raw[PREVIEW_FLAG] !== false,
    legacySocialPackEnabled: raw[SOCIAL_PACK_FLAG] !== false,
    authorInviteEnabled: raw[AUTHOR_INVITE_FLAG] !== false,
    assistantBrandKitToolsEnabled: raw[ASSISTANT_BRAND_KIT_FLAG] === true,
    updatedAt: text(raw.updatedAt) || null
  }
}

export function setWorkflowFlags({ db, assistantEnabled, blogWizardEnabled, legacyPreviewEnabled, legacySocialPackEnabled, authorInviteEnabled, assistantBrandKitToolsEnabled, actorId, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const previous = store(db)
  db.featureFlags = {
    ...previous,
    [ASSISTANT_FLAG]: typeof assistantEnabled === 'boolean' ? assistantEnabled : previous[ASSISTANT_FLAG] !== false,
    [BLOG_WIZARD_FLAG]: typeof blogWizardEnabled === 'boolean' ? blogWizardEnabled : previous[BLOG_WIZARD_FLAG] !== false,
    [PREVIEW_FLAG]: typeof legacyPreviewEnabled === 'boolean' ? legacyPreviewEnabled : previous[PREVIEW_FLAG] !== false,
    [SOCIAL_PACK_FLAG]: typeof legacySocialPackEnabled === 'boolean' ? legacySocialPackEnabled : previous[SOCIAL_PACK_FLAG] !== false,
    [AUTHOR_INVITE_FLAG]: typeof authorInviteEnabled === 'boolean' ? authorInviteEnabled : previous[AUTHOR_INVITE_FLAG] !== false,
    [ASSISTANT_BRAND_KIT_FLAG]: typeof assistantBrandKitToolsEnabled === 'boolean'
      ? assistantBrandKitToolsEnabled
      : previous[ASSISTANT_BRAND_KIT_FLAG] === true,
    updatedAt: text(now),
    ...(text(actorId) ? { updatedBy: text(actorId).slice(0, 120) } : {})
  }
  return getWorkflowFlags(db)
}
