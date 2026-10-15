export {
  CAPABILITY_KINDS,
  CAPABILITY_REVIEW_POLICIES,
  CAPABILITY_VISIBILITIES,
  CapabilityManifestError,
  ESCARLET_OS_CONTRACT_VERSION,
  capabilityKey,
  compareCapabilityVersions,
  hasCapabilityPermissions,
  normalizeCapabilityManifest
} from './contracts.mjs'

export {
  CapabilityRegistry,
  CapabilityRegistryError,
  DEFAULT_CAPABILITY_MANIFESTS,
  createDefaultCapabilityRegistry,
  listCapabilities,
  searchCapabilities
} from './registry.mjs'

export {
  ARTIFACT_KINDS,
  ARTIFACT_REFERENCE_SCHEMA,
  RUN_STATUSES,
  normalizeArtifact,
  normalizeArtifactReference,
  normalizeRunEnvelope
} from './artifacts.mjs'

import { DEFAULT_CAPABILITY_MANIFESTS } from './registry.mjs'

export function getOsRegistry() {
  return {
    capabilities: DEFAULT_CAPABILITY_MANIFESTS.filter((manifest) => manifest.kind !== 'recipe'),
    recipes: DEFAULT_CAPABILITY_MANIFESTS.filter((manifest) => manifest.kind === 'recipe')
  }
}
