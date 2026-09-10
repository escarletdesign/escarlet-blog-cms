import type { Author, MediaItem, Post, Session } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      data.message || "No se pudo completar la operación.",
      response.status,
    );
  return data as T;
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
  createDraft: (post: Partial<Post> & { title: string; site?: string }) =>
    request<{ post: Post }>("/api/admin/posts/create-draft", {
      method: "POST",
      body: JSON.stringify(post),
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
  checkout: (input: {
    site?: string;
    kind: "membership" | "credits";
    planId?: string;
    packId?: string;
  }) =>
    request<{
      site: string;
      configured: boolean;
      reason?: string;
      sessionId?: string | null;
      url: string | null;
    }>("/api/admin/billing/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  billingPortal: (input: { site?: string; customerId: string }) =>
    request<{
      site: string;
      configured: boolean;
      reason?: string;
      url: string | null;
    }>("/api/admin/billing/portal", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  sites: () =>
    request<{
      sites: Array<{ handle?: string; id?: string; name?: string }>;
      handles: string[];
      role: string;
    }>("/api/admin/sites"),
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
  issueSiteToken: (site: string, refreshIcon = false) =>
    request<{ siteAccessToken: string; message?: string; agentIcon?: Record<string, any> }>(
      `/api/admin/site-config/${encodeURIComponent(site)}/access-token`,
      { method: "POST", body: JSON.stringify({ refreshIcon }) },
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
  generateImage: (input: {
    site?: string;
    prompt: string;
    slug?: string;
    alt?: string;
    title?: string;
  }) =>
    request<{ media: MediaItem; prompt: string }>("/api/ai/image", {
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
      flags: { creditCheckoutWithoutStripe: boolean; updatedAt?: string | null };
    }>('/api/admin/feature-flags'),
  saveFeatureFlags: (input: { creditCheckoutWithoutStripe: boolean }) =>
    request<{
      ok: boolean;
      flags: { creditCheckoutWithoutStripe: boolean; updatedAt?: string | null };
    }>('/api/admin/feature-flags', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
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
  quota?: Record<string, unknown>;
};

export type AiConversationMessage = { role: "assistant" | "user"; text: string };
export type AiConversation = {
  id: string;
  site: string;
  title: string;
  updatedAt: string;
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

async function aiChat(
  input: { site?: string; message: string; model?: string },
  onDelta?: (text: string) => void,
) {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      data.message || "El asistente no está disponible.",
      response.status,
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const consume = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const value = JSON.parse(line.slice(5).trim());
        if (typeof value.delta === "string") {
          content += value.delta;
          onDelta?.(content);
        }
      } catch {
        /* ignore malformed SSE frame */
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    frames.forEach(consume);
    if (done) break;
  }
  if (buffer) consume(buffer);
  return content;
}

async function aiGenerate(input: {
  site?: string;
  operation:
    | "title"
    | "summary"
    | "body"
    | "image"
    | "meta-description"
    | "brand-file"
    | "social-pack";
  prompt: string;
  post?: Partial<Post>;
  model?: string;
}) {
  return request<AiGeneration>("/api/ai/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function billingSnapshot(site?: string) {
  return request<Record<string, any>>(
    `/api/billing/snapshot${site ? `?site=${encodeURIComponent(site)}` : ""}`,
  );
}
async function billingCheckout(input: {
  site?: string;
  kind: "membership" | "credits";
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
async function billingPortal(input: { site?: string }) {
  return request<{ url?: string; configured?: boolean; reason?: string }>(
    "/api/billing/portal",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export const api = Object.assign(baseApi, {
  aiChat,
  aiGenerate,
  aiConversations,
  aiConversation,
  saveAiConversation,
  billingSnapshot,
  billingCheckout,
  billingPortal,
});
