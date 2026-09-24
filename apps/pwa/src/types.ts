export type Role = "owner" | "admin" | "editor" | "author" | "viewer" | string;
export type BrandCapability = "content_publishing" | "blog_publishing" | "presentation_generation" | "review_content" | "approve_content" | "schedule_content" | "manage_connections" | "manage_members" | "manage_billing" | string;

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
  hasLoginToken?: boolean;
  loginTokenHint?: string;
  workspaceId?: string;
  workspaceRole?: "owner" | "admin" | "editor" | "author" | "viewer" | string;
  brandRoles?: Record<string, string>;
}

export type ContentChannel = "blog" | "instagram" | "instagram_story" | "linkedin" | "x" | "video" | "substack";
export interface BrandChannel {
  channel: ContentChannel;
  enabled: boolean;
  connectionStatus?: string;
  provider?: string | null;
  connectionId?: string | null;
}
export interface BrandSummary {
  id: string;
  workspaceId?: string;
  handle?: string;
  name?: string;
  role?: Role;
  domain?: string | null;
  channels?: BrandChannel[];
  capabilities?: Record<string, boolean>;
  connections?: Array<Record<string, any>>;
}
export type ContentStatus = "draft" | "generated" | "needs_review" | "approved" | "scheduled" | "syncing" | "action_required" | "published" | "failed" | "canceled";
export interface ContentVariant {
  id: string;
  channel: ContentChannel;
  status: ContentStatus;
  body: Record<string, any>;
  media?: MediaItem[];
  publicationDate?: string;
  scheduleTimezone?: string;
  scheduleStatus?: ContentStatus;
  lastError?: string | null;
}
export interface ContentItem {
  id: string;
  batch_id?: string;
  batchId?: string;
  topic: string;
  planTitle?: string;
  planStatus?: ContentStatus;
  metadata?: Record<string, any>;
  status: ContentStatus;
  variants: ContentVariant[];
  error?: string | null;
}
export interface ContentBatch {
  id: string;
  workspace_id?: string;
  site_id?: string;
  title: string;
  status: ContentStatus;
  total_items: number;
  generated_items: number;
  failed_items: number;
  items: ContentItem[];
}

export interface ContentPlanSummary {
  id: string;
  title: string;
  status: ContentStatus;
  totalItems: number;
  generatedItems: number;
  failedItems: number;
  channels: ContentChannel[];
  created_at?: string;
  updated_at?: string;
}

export interface Post {
  itemId?: string;
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
  articleUrl?: string;
  contentSource?: string;
  assistantConversationId?: string;
  /** Decision metadata from content-system visual v2. */
  visualBrief?: Record<string, any>;
  imageMetadata?: Record<string, any>;
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
  metadata?: Record<string, any>;
  metadataSanitized?: boolean;
}

export interface GeneratedImage extends MediaItem {
  generatedAt?: string;
  prompt?: string;
}
