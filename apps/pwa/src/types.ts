export type Role = 'admin' | 'agency_admin' | 'client' | 'site' | string

export interface Session {
  role: Role
  site?: string
  sites?: string[]
  userId?: string
  capabilities?: string[]
  email?: string
}

export interface Post {
  slug: string
  site: string
  title: string
  status: string
  bodyHtml: string
  excerptEs?: string
  metaTitle?: { es?: string }
  metaDescription?: { es?: string }
  imageUrl?: string
  imageAlt?: string
  authorName?: string
  datePublished?: string
  dateModified?: string
  publishAt?: string
  contentSource?: string
  socialPack?: Record<string, string>
}
