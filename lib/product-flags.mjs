/**
 * Feature flag for product-restructure phases F0+.
 * Set PRODUCT_RESTRUCTURE_V1=1 (or true) to enable new fields, roles, and review links.
 */
export function isProductRestructureV1() {
  const raw = String(process.env.PRODUCT_RESTRUCTURE_V1 || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}
