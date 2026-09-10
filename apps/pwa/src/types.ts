export type Role = "admin" | "agency_admin" | "client" | "client_mcp" | "site" | string;

export interface Session {
  role: Role;
  site?: string;
  sites?: string[];
  userId?: string;
  capabilities?: string[];
  email?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  profileComplete?: boolean;
  allowPublishingAs?: boolean;
}

export interface Post {
  slug: string;
  site: string;
  title: string;
  status: string;
  bodyHtml: string;
  excerptEs?: string;
  metaTitle?: { es?: string };
  metaDescription?: { es?: string };
  imageUrl?: string;
  imageThumbUrl?: string;
  imageAlt?: string;
  /** Images generated for this post, kept so a later option can be reused. */
  imageGallery?: GeneratedImage[];
  authorName?: string;
  datePublished?: string;
  dateModified?: string;
  publishAt?: string;
  contentSource?: string;
  assistantConversationId?: string;
  socialPack?: Record<string, any>;
}

export interface Author {
  id?: string;
  userId?: string;
  name: string;
  url?: string;
  avatarUrl?: string;
  bio?: string;
  allowPublishingAs?: boolean;
  canPublishAs?: boolean;
}

export interface MediaItem {
  id?: string;
  site?: string;
  path?: string;
  url?: string;
  thumbUrl?: string;
  thumbPath?: string;
  filename?: string;
  alt?: string;
  kind?: string;
}

export interface GeneratedImage extends MediaItem {
  generatedAt?: string;
  prompt?: string;
}
