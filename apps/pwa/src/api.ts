import type { Author, BrandCapability, BrandChannel, BrandSummary, ContentBatch, ContentItem, GeneratedImage, MediaItem, Post, Session } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: Record<string, unknown> = {},
    public code?: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

export type ApiRequestOptions = RequestInit & { timeoutMs?: number };

export async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { timeoutMs = 30_000, signal: upstreamSignal, headers: upstreamHeaders, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Tiempo de espera agotado", "TimeoutError")), timeoutMs);
  const abort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) abort();
    else upstreamSignal.addEventListener("abort", abort, { once: true });
  }
  const headers = options.body instanceof FormData
    ? upstreamHeaders
    : { "Content-Type": "application/json", ...(upstreamHeaders || {}) };
  try {
    const response = await fetch(path, {
      credentials: "include",
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    const requestId = response.headers.get("x-request-id") || data.requestId;
    if (!response.ok) throw new ApiError(data.message || "No se pudo completar la operación.", response.status, data, data.code, requestId);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError("La operación fue cancelada o agotó el tiempo de espera.", 0, {}, controller.signal.reason?.name === "TimeoutError" ? "timeout" : "aborted");
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abort);
  }
}

const baseApi = {
  session: () => request<Session>("/api/admin/session"),
  loginWithToken: (token: string) =>
    request<Session>("/api/login", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  requestMagicLink: (email: string) =>
    request<{ ok: boolean }>("/api/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  sendMagicLink: (input: { email: string; site?: string; role?: string }) =>
    request<{
      ok: boolean;
      expiresAt: string;
      transport?: string;
      link?: string;
    }>("/api/magic/send", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  profile: () =>
    request<{ profile: Record<string, any> }>("/api/auth/profile"),
  saveProfile: (input: {
    displayName: string;
    bio: string;
    avatarDataUrl?: string;
    allowPublishingAs?: boolean;
  }) =>
    request<{ ok: boolean; profile: Record<string, any> }>("/api/auth/profile", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  issueOwnUserToken: () =>
    request<{ ok: boolean; profile: Record<string, any>; token: string }>("/api/auth/profile/token", {
      method: "POST",
    }),
  revokeOwnUserToken: () =>
    request<{ ok: boolean; profile: Record<string, any> }>("/api/auth/profile/token/revoke", {
      method: "POST",
    }),
  createAuthorInvite: (site?: string) =>
    request<{ ok: boolean; link: string; token: string; expiresAt: string }>("/api/auth/profile/publishing-link", {
      method: "POST",
      body: JSON.stringify({ site }),
    }),
  acceptAuthorInvite: (token: string) =>
    request<{ ok: boolean; site: string }>("/api/auth/profile/publishing-link/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  publishingDelegates: (site?: string) =>
    request<{
      site: string;
      users: Array<Record<string, any>>;
    }>(`/api/auth/profile/delegates${site ? `?site=${encodeURIComponent(site)}` : ""}`),
  setPublishingDelegate: (input: { site?: string; delegateId: string; enabled: boolean }) =>
    request<{ ok: boolean; site: string; enabled: boolean; delegate: Record<string, any> }>(
      "/api/auth/profile/delegates",
      { method: "POST", body: JSON.stringify(input) },
    ),
  posts: (site?: string) =>
    request<{ posts: Post[] }>(
      `/api/admin/posts${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  post: (slug: string, site?: string) =>
    request<{ post: Post }>(
      `/api/admin/posts/${encodeURIComponent(slug)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  deletePost: (slug: string, site?: string) =>
    request<{ deleted: boolean; message?: string }>(
      `/api/admin/posts/${encodeURIComponent(slug)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
      { method: "DELETE" },
    ),
  createDraft: (post: Partial<Post> & { title: string; site?: string }) =>
    request<{ post: Post }>("/api/admin/posts/create-draft", {
      method: "POST", headers: { "X-Escarlet-Client": "pwa" },
      body: JSON.stringify(post),
    }),
  transcribe: (input: { site?: string; audioBase64: string; mimeType?: string; filename?: string }) =>
    request<{ text: string; model?: string }>("/api/ai/transcribe", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePost: (
    post: Partial<Post> & {
      slug: string;
      site?: string;
      originalSlug?: string;
      direct?: boolean;
      keepPublished?: boolean;
    },
  ) =>
    request<{ post: Post; validation?: Record<string, unknown> }>(
      "/api/admin/posts",
      { method: "POST", body: JSON.stringify(post) },
    ),
  publish: (
    slug: string,
    site?: string,
    publishAt?: string,
    options?: { ignoreSeo?: boolean; direct?: boolean },
  ) =>
    request<{
      post: Post;
      message?: string;
      published?: boolean;
      submittedForReview?: boolean;
      seoBypassed?: boolean;
    }>("/api/admin/posts/publish", {
      method: "POST",
      body: JSON.stringify({
        slug,
        site,
        publishAt,
        ignoreSeo: Boolean(options?.ignoreSeo),
        direct: Boolean(options?.direct),
      }),
    }),
  schedule: (
    slug: string,
    publishAt: string,
    site?: string,
    options?: { ignoreSeo?: boolean; direct?: boolean },
  ) =>
    request<{ post: Post; message?: string; seoBypassed?: boolean }>(
      "/api/admin/posts/schedule",
      {
        method: "POST",
        body: JSON.stringify({
          slug,
          site,
          publishAt,
          ignoreSeo: Boolean(options?.ignoreSeo),
          direct: Boolean(options?.direct),
        }),
      },
    ),
  calendar: (site?: string) =>
    request<{ posts: Post[] }>(
      `/api/admin/posts/calendar${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  socialPack: (slug: string, site?: string) =>
    request<{
      pack: { channels?: Record<string, string>; [key: string]: unknown };
    }>(
      `/api/admin/social-pack/${encodeURIComponent(slug)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  quota: (site?: string) =>
    request<Record<string, unknown>>(
      `/api/admin/quota${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  billing: (site?: string) =>
    request<Record<string, unknown>>(
      `/api/admin/billing${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  sites: () =>
    request<{
      sites: Array<{ handle?: string; id?: string; name?: string }>;
      handles: string[];
      role: string;
      }>("/api/admin/sites"),
  contentBatches: (site?: string) =>
    request<{ items: ContentItem[] }>(
      `/api/v2/content/items${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  contentPlans: (site?: string, signal?: AbortSignal) =>
    request<{ plans: Array<Record<string, any>> }>(
      `/api/v2/content/plans${site ? `?site=${encodeURIComponent(site)}` : ""}`,
      { signal },
    ),
  context: (site?: string, signal?: AbortSignal) =>
    request<{
      workspace: { id: string; name?: string };
      activeBrand?: { id: string; handle?: string; name?: string; role?: string } | null;
      brands: Array<{ id: string; handle?: string; name?: string }>;
      role: string;
      capabilities: string[];
      brandCapabilities: Record<string, boolean>;
      featureFlags: { creation_ui_enabled: boolean; manual_creation_enabled: boolean; [key: string]: boolean };
      channels: Array<{ channel: string; enabled: boolean; connectionStatus: string }>;
      connections: Array<Record<string, any>>;
      usage?: Record<string, any>;
    }>(`/api/v2/context${site ? `?site=${encodeURIComponent(site)}` : ""}`, { signal }),
  brands: () =>
    request<{ brands: BrandSummary[] }>("/api/v2/brands"),
  createBrand: (input: { handle: string; name: string; domain?: string }) =>
    request<{ brand: BrandSummary }>("/api/v2/brands", { method: "POST", body: JSON.stringify(input) }),
  brandV2: (brandId: string, signal?: AbortSignal) =>
    request<{ brand: BrandSummary }>(`/api/v2/brands/${encodeURIComponent(brandId)}`, { signal }),
  updateBrandV2: (brandId: string, input: { name?: string; domain?: string }) =>
    request<{ brand: BrandSummary }>(`/api/v2/brands/${encodeURIComponent(brandId)}`, { method: "PATCH", body: JSON.stringify(input) }),
  brandChannels: (brandId: string, signal?: AbortSignal) =>
    request<{ channels: BrandChannel[]; catalog: Array<Record<string, any>> }>(`/api/v2/brands/${encodeURIComponent(brandId)}/channels`, { signal }),
  updateBrandChannels: (brandId: string, channels: Record<string, boolean>) =>
    request<{ channels: BrandChannel[] }>(`/api/v2/brands/${encodeURIComponent(brandId)}/channels`, { method: "PATCH", body: JSON.stringify({ channels }) }),
  brandCapabilities: (brandId: string, signal?: AbortSignal) =>
    request<{ capabilities: Record<string, boolean>; catalog: BrandCapability[] }>(`/api/v2/brands/${encodeURIComponent(brandId)}/capabilities`, { signal }),
  updateBrandCapabilities: (brandId: string, capabilities: Record<string, boolean>) =>
    request<{ capabilities: Record<string, boolean> }>(`/api/v2/brands/${encodeURIComponent(brandId)}/capabilities`, { method: "PATCH", body: JSON.stringify({ capabilities }) }),
  brandConnections: (brandId: string, signal?: AbortSignal) =>
    request<{ connections: Array<Record<string, any>> }>(`/api/v2/brands/${encodeURIComponent(brandId)}/connections`, { signal }),
  saveBrandConnection: (brandId: string, input: Record<string, any>) =>
    request<{ connection: Record<string, any> }>(`/api/v2/brands/${encodeURIComponent(brandId)}/connections`, { method: "POST", body: JSON.stringify(input) }),
  postizIntegrations: (brandId: string, input: { apiToken: string; apiBaseUrl?: string }) =>
    request<{ integrations: Array<Record<string, any>> }>(`/api/v2/brands/${encodeURIComponent(brandId)}/connections/postiz/integrations`, { method: "POST", body: JSON.stringify(input) }),
  bufferChannels: (brandId: string, input: { apiToken: string; organizationId?: string; apiBaseUrl?: string }) =>
    request<{ organizations: Array<Record<string, any>>; organizationId?: string | null; channels: Array<Record<string, any>> }>(`/api/v2/brands/${encodeURIComponent(brandId)}/connections/buffer/channels`, { method: "POST", body: JSON.stringify(input) }),
  testConnection: (connectionId: string, site?: string) =>
    request<Record<string, any>>(`/api/v2/connections/${encodeURIComponent(connectionId)}/test${site ? `?site=${encodeURIComponent(site)}` : ""}`, { method: "POST", body: JSON.stringify({ site }) }),
  disconnectConnection: (connectionId: string, site?: string) =>
    request<{ connection: Record<string, any> }>(`/api/v2/connections/${encodeURIComponent(connectionId)}/disconnect${site ? `?site=${encodeURIComponent(site)}` : ""}`, { method: "POST", body: JSON.stringify({ site }) }),
  reviewItems: (site?: string, signal?: AbortSignal) =>
    request<{ items: ContentItem[] }>(`/api/v2/content/review${site ? `?site=${encodeURIComponent(site)}` : ""}`, { signal }),
  syncContentRemoteStatus: (site?: string) =>
    request<{ queued: number; bucket: string; types: string[] }>("/api/v2/content/sync-remote-status", {
      method: "POST",
      body: JSON.stringify(site ? { site } : {}),
    }),
  calendarV2: (site?: string) =>
    request<{ entries: Array<Record<string, any>> }>(`/api/v2/calendar${site ? `?site=${encodeURIComponent(site)}` : ""}`),
  teamV2: (site?: string) =>
    request<{ members: Array<Record<string, any>>; canManage: boolean }>(`/api/v2/team${site ? `?site=${encodeURIComponent(site)}` : ""}`),
  updateTeamMember: (userId: string, input: { role: string; brandIds?: string[]; brandRoles?: Record<string, string> }) =>
    request<{ member: Record<string, any> }>(`/api/v2/team/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(input) }),
  inviteTeamMember: (input: { email: string; role: string; brandIds?: string[]; brandRoles?: Record<string, string>; site?: string }) =>
    request<{ member: Record<string, any>; invite?: Record<string, any> }>("/api/v2/team/invitations", { method: "POST", body: JSON.stringify(input) }),
  updateFeatureFlags: (flags: Record<string, boolean>, site?: string, scope?: "workspace" | "brand") =>
    request<{ flags: Record<string, boolean> }>("/api/v2/feature-flags", {
      method: "PATCH",
      body: JSON.stringify({ site, scope, flags }),
    }),
  metricoolConnect: (input: { site?: string; channel?: string; userToken: string; userId: string; blogId: string; timezone?: string; capabilities?: Record<string, any> }) =>
    request<Record<string, any>>("/api/v2/integrations/metricool/connect", { method: "POST", body: JSON.stringify(input) }),
  metricoolTest: (site?: string) =>
    request<Record<string, any>>(`/api/v2/integrations/metricool/test${site ? `?site=${encodeURIComponent(site)}` : ""}`, { method: "POST", body: JSON.stringify({ site }) }),
  contentBatch: (batchId: string, site?: string) =>
    request<ContentBatch>(
      `/api/v2/content/batches/${encodeURIComponent(batchId)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  createContentBatch: (input: { site?: string; title: string; topics: string[]; channels: string[]; brandKitVersionId?: string; idempotencyKey?: string }) =>
    request<{ batchId: string; itemIds: string[]; status: "draft"; totalItems: number }>(
      "/api/v2/content/batches",
      { method: "POST", headers: { "X-Escarlet-Client": "pwa", "Idempotency-Key": input.idempotencyKey || crypto.randomUUID() }, body: JSON.stringify(input) },
    ),
  updateContentItem: (itemId: string, input: { site?: string; topic?: string; contentTitle?: string; channel?: string; body?: Record<string, any>; visualBrief?: Record<string, any>; mediaAssetIds?: string[]; readyForReview?: boolean; keepPublished?: boolean }) =>
    request<ContentItem>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  approveContent: (itemId: string, site?: string) =>
    request<{ itemId: string; status: string }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/approve`,
      { method: "POST", body: JSON.stringify({ site }) },
    ),
  scheduleContent: (itemId: string, publicationDate: string, timezone: string, site?: string, channels?: string[], options?: { publishNow?: boolean }) =>
    request<{ itemId: string; status: string }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/schedule`,
      { method: "POST", body: JSON.stringify({ site, channels, publicationDate, timezone, publishNow: options?.publishNow === true }) },
    ),
  rescheduleContent: (itemId: string, publicationDate: string, timezone: string, site?: string, channels?: string[], options?: { publishNow?: boolean }) =>
    request<{ itemId: string; status: string; channels: string[] }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/reschedule`,
      { method: "POST", body: JSON.stringify({ site, channels, publicationDate, timezone, publishNow: options?.publishNow === true }) },
    ),
  markChannelPublished: (itemId: string, channel: string, site?: string) =>
    request<{ itemId: string; status: string; channel: string }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/mark-published`,
      { method: "POST", body: JSON.stringify({ site, channel }) },
    ),
  reopenUnsentChannel: (itemId: string, channel: string, site?: string) =>
    request<{ itemId: string; status: string; channel: string }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/reopen-unsent-channel`,
      { method: "POST", body: JSON.stringify({ site, channel }) },
    ),
  publishContentViaBuffer: (itemId: string, channels: string[], site?: string, copy?: string) =>
    request<{ itemId: string; status: string; channels: string[]; provider: string; publicationDate: string }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/publish-buffer`,
      { method: "POST", body: JSON.stringify({ site, channels, copy }) },
    ),
  listVideoJobs: (site?: string, contentItemId?: string, status?: string) => {
    const params = new URLSearchParams();
    if (site) params.set("site", site);
    if (contentItemId) params.set("contentItemId", contentItemId);
    if (status) params.set("status", status);
    const query = params.toString();
    return request<{ jobs: Array<Record<string, unknown>> }>(`/api/v2/video/jobs${query ? `?${query}` : ""}`);
  },
  getVideoJob: (videoJobId: string, site?: string) =>
    request<{ job: Record<string, unknown> }>(
      `/api/v2/video/jobs/${encodeURIComponent(videoJobId)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  getVideoJobForContentItem: async (contentItemId: string, site?: string) => {
    const listed = await api.listVideoJobs(site, contentItemId);
    const job = listed.jobs?.[0] as { id?: string } | undefined;
    if (!job?.id) return { job: null as Record<string, unknown> | null };
    const detail = await api.getVideoJob(job.id, site);
    return detail;
  },
  updateVideoJob: (
    videoJobId: string,
    input: Record<string, unknown>,
    site?: string,
  ) =>
    request<{ job: Record<string, unknown> }>(
      `/api/v2/video/jobs/${encodeURIComponent(videoJobId)}`,
      { method: "PATCH", body: JSON.stringify({ ...input, site }) },
    ),
  uploadContentVideo: (itemId: string, file: File, site?: string, format: "portrait" | "landscape" = "portrait") => {
    const body = new FormData();
    body.append("site", site || "");
    body.append("format", format);
    body.append("filename", file.name || "escarlet-reel.webm");
    body.append("mimeType", file.type || "video/webm");
    body.append("file", file, file.name || "escarlet-reel.webm");
    return request<{ itemId: string; media: Record<string, any>; replacedPrevious: boolean }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/video`,
      { method: "POST", body },
    );
  },
  cancelContent: (itemId: string, site?: string) =>
    request<{ itemId: string; status: string }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/cancel`,
      { method: "POST", body: JSON.stringify({ site }) },
    ),
  cancelContentChannel: (itemId: string, channel: string, site?: string) =>
    request<{ itemId: string; channel: string; status: string; itemStatus: string }>(
      `/api/v2/content/items/${encodeURIComponent(itemId)}/cancel-channel`,
      { method: "POST", body: JSON.stringify({ site, channel }) },
    ),
  brandKitV2: (site?: string) =>
    request<Record<string, any>>(`/api/v2/brand-kits${site ? `?site=${encodeURIComponent(site)}` : ""}`),
  updateBrandKitAsset: (brandId: string, assetId: string, input: { alt?: string; usage?: string }) =>
    request<{ asset: Record<string, any> }>(`/api/v2/brands/${encodeURIComponent(brandId)}/brand-kit/assets/${encodeURIComponent(assetId)}`, { method: "PATCH", body: JSON.stringify(input) }),
  createBrandKitVersion: (input: { site?: string; manifest: Record<string, any>; status?: "draft" | "published" }) =>
    request<Record<string, any>>("/api/v2/brand-kits/versions", { method: "POST", body: JSON.stringify(input) }),
  createSite: (input: {
    handle: string;
    name?: string;
    domain?: string;
    authors?: string[];
    rebuildWebhookUrl?: string;
    coolifyApiToken?: string;
    requiresHumanApproval?: boolean;
    contentMode?: "blog" | "socialmedia";
  }) =>
    request<{
      ok: boolean;
      site: { handle: string; name: string; domain: string };
      config?: Record<string, any>;
    }>("/api/admin/sites", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  brand: (site: string) =>
    request<{
      summary?: string;
      files?: string[];
      labels?: Record<string, string>;
      authors?: Author[] | string[];
    }>(`/api/admin/brand-kit/${encodeURIComponent(site)}`),
  brandFile: (site: string, file: string) =>
    request<{ content?: string }>(
      `/api/admin/brand-kit/${encodeURIComponent(site)}/${encodeURIComponent(file)}`,
    ),
  saveBrandFile: (site: string, file: string, content: string) =>
    request<{ ok: boolean }>(
      `/api/admin/brand-kit/${encodeURIComponent(site)}/${encodeURIComponent(file)}`,
      { method: "POST", body: JSON.stringify({ content }) },
    ),
  importBrandZip: (site: string, contentBase64: string) =>
    request<{ ok: boolean; importedMd?: string[]; importedData?: string[]; importedImages?: string[]; skipped?: string[] }>(
      `/api/admin/brand-kit/${encodeURIComponent(site)}/import-zip`,
      { method: "POST", body: JSON.stringify({ contentBase64 }) },
    ),
  onboarding: (site: string) =>
    request<Record<string, any>>(
      `/api/admin/onboarding?site=${encodeURIComponent(site)}`,
    ),
  siteConfig: (site: string) =>
    request<{ config: Record<string, any> }>(
      `/api/admin/site-config/${encodeURIComponent(site)}`,
    ),
  saveSiteConfig: (site: string, input: Record<string, any>) =>
    request<{ config: Record<string, any>; rebuild?: Record<string, any> }>(
      `/api/admin/site-config/${encodeURIComponent(site)}`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  testSiteRebuild: (site: string) =>
    request<{ rebuild: Record<string, any>; message?: string }>(
      `/api/admin/site-config/${encodeURIComponent(site)}/test-rebuild`,
      { method: "POST" },
    ),
  mcpConnection: (site: string, signal?: AbortSignal) =>
    request<{ mcpUrl: string; mcpChatGptUrl?: string; mcpClaudeUrl?: string; mcpAuthHint?: string; mcpClaudeHint?: string; agentIcon?: Record<string, any> }>(
      `/api/admin/site-config/${encodeURIComponent(site)}/agent-icon`,
      { signal },
    ),
  users: (site: string, all = false) =>
    request<{ users: Array<Record<string, any>>; site: string }>(
      `/api/auth/users?site=${encodeURIComponent(site)}${all ? "&all=1" : ""}`,
    ),
  registerUser: (input: {
    email: string;
    role: string;
    sites: string[];
    invite?: boolean;
    password?: string;
  }) =>
    request<{ user: Record<string, any>; invite?: Record<string, any> }>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify({ ...input, invite: input.invite !== false }) },
    ),
  updateUser: (input: { id: string; email?: string; role: string; sites: string[]; allowPublishingAs?: boolean }) =>
    request<{ user: Record<string, any> }>("/api/auth/users/update", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteUser: (input: { id: string; site: string }) =>
    request<{ deleted: boolean }>("/api/auth/users/delete", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  issueUserToken: (id: string) =>
    request<{ token: string; user: Record<string, any> }>("/api/auth/users/token", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  revokeUserToken: (id: string) =>
    request<{ user: Record<string, any> }>("/api/auth/users/token/revoke", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  authors: (site?: string) =>
    request<{ authors: Author[] }>(
      `/api/admin/authors${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    ),
  media: (site?: string, kind?: string) =>
    request<{ media: MediaItem[] }>(
      `/api/admin/media${site || kind ? `?${new URLSearchParams({ ...(site ? { site } : {}), ...(kind ? { kind } : {}) })}` : ""}`,
    ),
  uploadMedia: (input: {
    site?: string;
    filename: string;
    contentBase64: string;
    alt?: string;
    kind?: string;
  }) =>
    request<{ media: MediaItem }>("/api/admin/media/upload", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteMedia: (input: { site?: string; id?: string; path?: string }) =>
    request<{ deleted: boolean }>("/api/admin/media/delete", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMediaAlt: (input: { site?: string; id: string; alt: string }) =>
    request<{ media: MediaItem }>("/api/admin/media/update-alt", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMedia: (input: { site?: string; id: string; filename?: string; alt?: string; usage?: string }) =>
    request<{ media: MediaItem }>("/api/admin/media/update", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  generateImage: (input: {
    site?: string;
    prompt: string;
    slug?: string;
    postSlug?: string;
    optionCount?: number;
    alt?: string;
    title?: string;
    allowText?: boolean;
    imageRole?: string;
    backgroundStyle?: string;
  }) =>
    request<{
      media: MediaItem;
      mediaOptions?: GeneratedImage[];
      gallery?: GeneratedImage[];
      persisted?: boolean;
      prompt: string;
    }>("/api/ai/image", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  validateSeo: (input: {
    site?: string;
    slug?: string;
    post?: Partial<Post>;
  }) =>
    request<Record<string, unknown>>("/api/admin/validate-seo", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  paymentLinks: () =>
    request<Record<string, unknown>>("/api/admin/payment-links"),
  aiProviders: () =>
    request<{
      providers: Array<{
        provider: string;
        name: string;
        enabled: boolean;
        model: string;
        apiKeyConfigured: boolean;
        apiKeyHint?: string;
        credentialSource: string;
      }>;
    }>("/api/admin/ai/providers"),
  saveAiProvider: (input: {
    provider: string;
    enabled: boolean;
    model: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }) =>
    request<{ provider: Record<string, unknown> }>("/api/admin/ai/providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  testAiProvider: async (provider: string) => {
    const response = await fetch(
      `/api/admin/ai/providers/${encodeURIComponent(provider)}/test`,
      { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !data.result) {
      throw new ApiError(data.message || "No se pudo completar la operación.", response.status);
    }
    return data as {
      result: {
        ok: boolean;
        reason?: string;
        latencyMs?: number;
        model?: string;
        status?: number | null;
      };
    };
  },
  featureFlags: () =>
    request<{
      flags: {
        cmsAiEnabled: boolean;
        creditCheckoutWithoutStripe: boolean;
        assistantEnabled: boolean;
        blogWizardEnabled: boolean;
        legacyPreviewEnabled: boolean;
        legacySocialPackEnabled: boolean;
        authorInviteEnabled: boolean;
        updatedAt?: string | null;
      };
    }>('/api/admin/feature-flags'),
  saveFeatureFlags: (input: {
    cmsAiEnabled?: boolean;
    creditCheckoutWithoutStripe?: boolean;
    assistantEnabled?: boolean;
    blogWizardEnabled?: boolean;
    legacyPreviewEnabled?: boolean;
    legacySocialPackEnabled?: boolean;
    authorInviteEnabled?: boolean;
  }) =>
    request<{
      ok: boolean;
      flags: {
        cmsAiEnabled: boolean;
        creditCheckoutWithoutStripe: boolean;
        assistantEnabled: boolean;
        blogWizardEnabled: boolean;
        legacyPreviewEnabled: boolean;
        legacySocialPackEnabled: boolean;
        authorInviteEnabled: boolean;
        updatedAt?: string | null;
      };
    }>('/api/admin/feature-flags', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  workflowFlags: (site?: string) =>
    request<{
      flags: { cmsAiEnabled: boolean; assistantEnabled: boolean; blogWizardEnabled: boolean; legacyPreviewEnabled: boolean; legacySocialPackEnabled: boolean; authorInviteEnabled: boolean; creation_ui_enabled?: boolean; manual_creation_enabled?: boolean; updatedAt?: string | null };
    }>(`/api/app/feature-flags${site ? `?site=${encodeURIComponent(site)}` : ""}`),
  creditPacks: () =>
    request<{
      packs: Array<{
        id: string;
        name: string;
        tokenCredits: number;
        configured: boolean;
      }>;
    }>("/api/admin/billing/credit-packs"),
  saveCreditPack: (input: {
    id: string;
    name: string;
    tokenCredits: number;
    enabled?: boolean;
    priceId?: string;
    clearPriceId?: boolean;
  }) =>
    request<{ pack: Record<string, unknown> }>(
      "/api/admin/billing/credit-packs",
      { method: "POST", body: JSON.stringify(input) },
    ),
  deleteCreditPack: (id: string) =>
    request<{ id: string; deleted: boolean }>(
      `/api/admin/billing/credit-packs/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};

export type AiGeneration = {
  content?: string;
  operation?: string;
  provider?: string;
  mode?: string;
  socialPack?: Record<string, any>;
  socialPackWarnings?: string[];
  socialPackJobId?: string;
  socialPackStatus?: "processing" | "completed" | "error";
  socialPackPersisted?: boolean;
  post?: Post;
  quota?: Record<string, unknown>;
};

export type SocialPackJobResult = {
  jobId: string;
  site: string;
  slug: string;
  status: "processing" | "completed" | "error";
  warnings?: string[];
  message?: string;
  socialPack?: Record<string, any>;
  post?: Post;
  updatedAt?: string;
};

export type AiConversationMessage = { role: "assistant" | "user"; text: string };
export type AiConversation = {
  id: string;
  site: string;
  title: string;
  updatedAt: string;
  archivedAt?: string;
  publishedSlug?: string;
  messageCount?: number;
  messages?: AiConversationMessage[];
};

async function aiConversations(site?: string) {
  return request<{ conversations: AiConversation[] }>(
    `/api/ai/conversations${site ? `?site=${encodeURIComponent(site)}` : ""}`,
  );
}

async function aiConversation(id: string, site?: string) {
  return request<{ conversation: AiConversation }>(
    `/api/ai/conversations/${encodeURIComponent(id)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
  );
}

async function saveAiConversation(input: AiConversation & { site?: string }) {
  return request<{ conversation: AiConversation }>("/api/ai/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function deleteAiConversation(id: string, site?: string) {
  return request<{ deleted: boolean }>(
    `/api/ai/conversations/${encodeURIComponent(id)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    { method: "DELETE" },
  );
}

async function aiChat(
  input: { site?: string; message: string; model?: string },
  onDelta?: (text: string) => void,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Tiempo de espera agotado", "TimeoutError")), options.timeoutMs ?? 60_000);
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
  }
  let response: Response;
  try {
    response = await fetch("/api/ai/chat", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Escarlet-Client": "pwa" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    if (controller.signal.aborted) throw new ApiError("El chat fue cancelado o agotó el tiempo de espera.", 0, {}, controller.signal.reason?.name === "TimeoutError" ? "timeout" : "aborted");
    throw error;
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    throw new ApiError(data.message || "El asistente no está disponible.", response.status, data, data.code, response.headers.get("x-request-id") || data.requestId);
  }
  try {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let sawDone = false;
    const consume = (chunk: string) => {
      for (const frame of chunk.split("\n\n")) {
        const event = frame.match(/^event:\s*([^\n]+)/m)?.[1]?.trim();
        const line = frame.split("\n").find((entry) => entry.startsWith("data:"));
        if (!line) continue;
        try {
          const value = JSON.parse(line.slice(5).trim());
          if (event === "error" || value?.error) throw new ApiError(value.message || value.error || "El asistente devolvió un error.", Number(value.status) || 502, value, value.code);
          if (event === "done") sawDone = true;
          if (typeof value.delta === "string") {
            content += value.delta;
            onDelta?.(content);
          }
        } catch (error) {
          if (error instanceof ApiError) throw error;
          if (event === "error") throw new ApiError(line.slice(5).trim() || "El asistente devolvió un error.", 502, {}, "sse_error");
          // A malformed frame is ignored only when it is not an error event.
        }
      }
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        frames.forEach(consume);
        if (done) break;
      }
      if (buffer) consume(buffer);
      if (!sawDone && !controller.signal.aborted) throw new ApiError("La conexión del asistente terminó antes de completar la respuesta.", 502, {}, "sse_incomplete");
      return content;
    } catch (error) {
      if (controller.signal.aborted) throw new ApiError("El chat fue cancelado o agotó el tiempo de espera.", 0, {}, controller.signal.reason?.name === "TimeoutError" ? "timeout" : "aborted");
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function aiGenerate(input: {
  site?: string;
  operation:
    | "title"
    | "summary"
    | "body"
    | "humanize"
    | "image"
    | "meta-description"
    | "brand-file"
    | "social-pack";
  prompt: string;
  post?: Partial<Post>;
  model?: string;
  asyncImages?: boolean;
}) {
  return request<AiGeneration>("/api/ai/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function socialPackJob(jobId: string, site?: string) {
  return request<SocialPackJobResult>(
    `/api/ai/social-pack/jobs/${encodeURIComponent(jobId)}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
  );
}

async function aiTools() {
  return request<{ protocol: string; version: string; tools: Array<Record<string, unknown>> }>("/api/ai/tools");
}

async function aiToolCall(name: string, args: Record<string, unknown> = {}) {
  return request<{ protocol: string; version: string; content?: Array<{ type: string; text?: string }>; isError?: boolean }>("/api/ai/tools/call", {
    method: "POST",
    body: JSON.stringify({ name, arguments: args }),
  });
}

async function billingSnapshot(site?: string) {
  return request<Record<string, any>>(
    `/api/billing/snapshot${site ? `?site=${encodeURIComponent(site)}` : ""}`,
  );
}
async function billingCheckout(input: {
  site?: string;
  kind: "credits";
  planId?: string;
  packId?: string;
}) {
  return request<{
    url?: string;
    configured?: boolean;
    reason?: string;
    testMode?: boolean;
    credited?: boolean;
    tokenCredits?: number;
    balance?: number;
  }>(
    "/api/billing/checkout",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export const api = Object.assign(baseApi, {
  aiChat,
  aiGenerate,
  socialPackJob,
  aiTools,
  aiToolCall,
  aiConversations,
  aiConversation,
  saveAiConversation,
  deleteAiConversation,
  billingSnapshot,
  billingCheckout,
});
