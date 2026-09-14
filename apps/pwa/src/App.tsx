import {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { api } from "./api";
import type { AiConversation, SocialPackJobResult } from "./api";
import { getInitialLanguage, Language, translate } from "./i18n";
import type { Author, MediaItem, Post, Session } from "./types";

type Draft = Partial<Post> & { title: string; slug?: string };
type WorkflowFlags = { cmsAiEnabled: boolean; assistantEnabled: boolean; blogWizardEnabled: boolean };
type SocialPackChannels = {
  substack: boolean;
  linkedin: boolean;
  x: boolean;
  videoScript: boolean;
  instagramCarousel: boolean;
};
const DEFAULT_SOCIAL_PACK_CHANNELS: SocialPackChannels = {
  substack: true,
  linkedin: true,
  x: true,
  videoScript: true,
  instagramCarousel: true,
};
const SOCIAL_PACK_CHANNEL_KEYS: Array<{ key: keyof SocialPackChannels; labelKey: string }> = [
  { key: "substack", labelKey: "admin.socialPackSubstack" },
  { key: "linkedin", labelKey: "admin.socialPackLinkedin" },
  { key: "x", labelKey: "admin.socialPackX" },
  { key: "videoScript", labelKey: "admin.socialPackVideo" },
  { key: "instagramCarousel", labelKey: "admin.socialPackInstagram" },
];
type AppState = {
  session: Session;
  site: string;
  sites: string[];
  workflowFlags: WorkflowFlags;
  setSite: (site: string) => void;
  refresh: () => Promise<void>;
};
const SessionContext = createContext<AppState | null>(null);
type I18nState = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, fallback?: string) => string;
};
const I18nContext = createContext<I18nState | null>(null);
type ToastKind = "success" | "error" | "info";
type Toast = { id: number; message: string; kind: ToastKind };
type ToastState = {
  showToast: (message: string, kind?: ToastKind) => void;
};
const ToastContext = createContext<ToastState | null>(null);
const useApp = () => {
  const value = useContext(SessionContext);
  if (!value) throw new Error("App context unavailable");
  return value;
};
const useI18n = () => {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18n context unavailable");
  return value;
};
const useToast = () => {
  const value = useContext(ToastContext);
  if (!value) throw new Error("Toast context unavailable");
  return value;
};
const isAdmin = (role?: string) => role === "admin" || role === "agency_admin";
function AiOnly({ children }: { children: ReactNode }) {
  const { session, workflowFlags } = useApp();
  return session.role === "client_mcp" || !workflowFlags.cmsAiEnabled ? null : <>{children}</>;
}
const roleLabel = (role: string | undefined, t: (key: string, fallback?: string) => string) => {
  const value = String(role || "client").trim().toLowerCase();
  return t(`role.${value}`, value.replace(/_/g, " "));
};
const uiStatus = (status?: string) => {
  if (status === "pending_schedule") return "scheduled";
  if (status === "review" || status === "changes_requested") return "draft";
  return status || "draft";
};
const hasSocialPack = (post?: Partial<Post> | null) => {
  const pack = post?.socialPack;
  if (!pack || typeof pack !== "object") return false;
  const meaningfulText = ["substackBody", "linkedin", "x", "videoScript", "instagramCaption"].some((key) => {
    const value = pack[key];
    return typeof value === "string" && value.trim() && !/^(?:escribe aquí|write here|añade aquí|add here)/i.test(value.trim());
  });
  const meaningfulSlides = Array.isArray(pack.instagramSlides) && pack.instagramSlides.some((slide: any) =>
    Boolean(slide?.imageUrl || slide?.url || slide?.headline || slide?.body),
  );
  return meaningfulText || meaningfulSlides;
};
const readableDate = (value?: string, language: Language = "es") =>
  value
    ? new Intl.DateTimeFormat(language === "en" ? "en-GB" : "es-ES", {
        dateStyle: "medium",
        timeStyle: value.includes("T") ? "short" : undefined,
      }).format(new Date(value))
    : translate(language, "common.noDate");
const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
const MAX_EDITOR_TITLE_CHARS = 72;
const cleanGeneratedTitle = (value: string, max = MAX_EDITOR_TITLE_CHARS) =>
  String(value || "")
    .split(/\r?\n/)[0]
    .replace(/^\s*(?:#+\s*|[-*•]|\d+[.)])\s*/, "")
    .replace(/^(?:t[ií]tulo sugerido|suggested title|propuesta editorial)\s+para\s+[^:]{1,90}:\s*/i, "")
    .replace(/^(?:t[ií]tulo(?: sugerido| propuesto)?|suggested title|propuesta editorial)\s*[:\-]\s*/i, "")
    .replace(/^['"“”]+|['"“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[,:;.!?\-\s]+$/, "")
    .trim();
const fileAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

async function waitForSocialPackJob(
  jobId: string,
  site: string,
  onStatus?: (status: SocialPackJobResult) => void,
) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api.socialPackJob(jobId, site);
    onStatus?.(status);
    if (status.status === "completed") return status;
    if (status.status === "error") {
      throw new Error(status.message || "No se pudo generar el Social Pack.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error(
    "La generación del Social Pack sigue en curso. Puedes volver a abrirlo en unos instantes.",
  );
}

function ChoicePills({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="choice-pills" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`choice-pill ${value === option.value ? "selected" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ModelPicker({
  name,
  value,
  options,
  ariaLabel,
}: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  const [selected, setSelected] = useState(value);
  useEffect(() => setSelected(value), [value]);
  const choices = options.length ? options : [{ value, label: value }];
  return (
    <div className="model-picker">
      <input
        name={name}
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        placeholder="gpt-4.1-mini"
        autoComplete="off"
        aria-label={ariaLabel}
      />
      <ChoicePills
        value={selected}
        ariaLabel={ariaLabel}
        onChange={setSelected}
        options={choices}
      />
    </div>
  );
}

function AppBrand() {
  const { t } = useI18n();
  return (
    <>
      <img className="brand-icon" src="/app/icon.png" alt="" />
      <span className="brand-name">Escarlet CMS</span>
      <span className="beta-badge">{t("app.beta")}</span>
    </>
  );
}

function MobileSocialIcon() {
  return (
    <svg
      className="social-mobile-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10 5h4" />
      <circle cx="12" cy="18.2" r=".7" fill="currentColor" stroke="none" />
      <path d="m9.4 11.2 2.2-2.2 2.2 2.2" />
      <path d="M11.6 9v5.2" />
    </svg>
  );
}

function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = (message: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  };
  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
            <span aria-hidden="true">{toast.kind === "error" ? "!" : toast.kind === "info" ? "i" : "✓"}</span>
            <p>{toast.message}</p>
            <button
              type="button"
              className="toast-close"
              aria-label={t("common.closeToast")}
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflowFlags, setWorkflowFlags] = useState<WorkflowFlags>({ cmsAiEnabled: true, assistantEnabled: true, blogWizardEnabled: true });
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);
  const [site, setSiteState] = useState("");
  const setLanguage = (next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem("escarlet_language", next);
  };
  const t = (key: string, fallback?: string) =>
    translate(language, key, fallback);
  const refresh = async () => {
    try {
      const nextSession = await api.session();
      setSession(nextSession);
      try {
        const nextFlags = await api.workflowFlags(nextSession.site || nextSession.sites?.[0]);
        const cmsAiEnabled = nextSession.role !== "client_mcp" && nextFlags.flags?.cmsAiEnabled !== false;
        setWorkflowFlags({
          cmsAiEnabled,
          assistantEnabled: cmsAiEnabled && nextFlags.flags?.assistantEnabled !== false,
          blogWizardEnabled: cmsAiEnabled && nextFlags.flags?.blogWizardEnabled !== false,
        });
      } catch {
        setWorkflowFlags({ cmsAiEnabled: nextSession.role !== "client_mcp", assistantEnabled: nextSession.role !== "client_mcp", blogWizardEnabled: nextSession.role !== "client_mcp" });
      }
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!session) return;
    const available = session.sites?.length
      ? session.sites
      : [session.site || "escarlet"];
    const requested = new URLSearchParams(window.location.search).get("site")?.trim().toLowerCase() || "";
    const requestedHandle = requested
      ? available.find((candidate) => {
          const normalized = String(candidate).trim().toLowerCase();
          return normalized === requested || normalized === requested.split(".")[0];
        }) || ""
      : "";
    const saved = window.localStorage.getItem("escarlet_site") || "";
    const next = requestedHandle || (available.includes(saved)
      ? saved
      : session.site && available.includes(session.site)
        ? session.site
        : available[0]);
    if (requestedHandle) window.localStorage.setItem("escarlet_site", requestedHandle);
    setSiteState((current) =>
      requestedHandle || (current && available.includes(current) ? current : next),
    );
  }, [session]);
  const setSite = (next: string) => {
    setSiteState(next);
    window.localStorage.setItem("escarlet_site", next);
  };
  const basename =
    window.location.pathname === "/app" ||
    window.location.pathname.startsWith("/app/")
      ? "/app"
      : undefined;
  if (loading)
    return (
      <I18nContext.Provider value={{ language, setLanguage, t }}>
        <div className="splash" role="status" aria-live="polite">
          <div className="splash-card">
            <div className="brand splash-brand"><AppBrand /></div>
            <div className="splash-loader" aria-hidden="true"><span /></div>
            <p>{t("app.loading")}</p>
          </div>
        </div>
      </I18nContext.Provider>
    );
  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      <BrowserRouter basename={basename}>
        <ToastProvider>
        {session ? (
          <SessionContext.Provider
            value={{
              session,
              site: site || session.site || session.sites?.[0] || "escarlet",
              sites: session.sites?.length
                ? session.sites
                : [session.site || "escarlet"],
              workflowFlags,
              setSite,
              refresh,
            }}
          >
            <Routes>
              {session.userId && session.profileComplete === false ? (
                <>
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="*" element={<Navigate to="/onboarding" replace />} />
                </>
              ) : <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                {workflowFlags.assistantEnabled && <Route path="/chat" element={<Chat />} />}
                {workflowFlags.blogWizardEnabled && <Route path="/quick-create" element={<QuickCreate />} />}
                <Route path="/manual/:slug?" element={<ManualPost />} />
                <Route path="/preview/:slug" element={<Preview />} />
                <Route path="/schedule/:slug" element={<Schedule />} />
                <Route path="/publish/:slug" element={<PublishSocial />} />
                <Route path="/social-pack" element={<SocialPack />} />
                <Route path="/social-pack/:slug" element={<SocialPack />} />
                <Route path="/posts" element={<Posts />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/author-invite" element={<AuthorInvite />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/admin" element={<AdminGate />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>}
            </Routes>
          </SessionContext.Provider>
        ) : (
          <Routes>
            <Route path="*" element={<Login onLogin={refresh} />} />
          </Routes>
        )}
        </ToastProvider>
      </BrowserRouter>
    </I18nContext.Provider>
  );
}

function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [magicError, setMagicError] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTokenError("");
    setSubmitting(true);
    try {
      await api.loginWithToken(token.trim());
      await onLogin();
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : t("login.signInError"));
    } finally {
      setSubmitting(false);
    }
  };
  const sendMagic = async (event: FormEvent) => {
    event.preventDefault();
    setMagicError("");
    setMagicSent(false);
    setSubmitting(true);
    try {
      await api.requestMagicLink(email.trim());
      setMagicSent(true);
    } catch (e) {
      setMagicError(e instanceof Error ? e.message : t("login.magicError"));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand">
          <AppBrand />
        </div>
        <p className="eyebrow">{t("login.eyebrow")}</p>
        <h1>{t("login.title")}</h1>
        <p className="muted">{t("login.description")}</p>
        <form className="login-token-form" onSubmit={submit}>
          <label>
            {t("login.token")}
            <div className="token-input-wrap">
              <span aria-hidden="true">⌁</span>
              <input
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("login.tokenPlaceholder")}
                autoComplete="off"
              />
            </div>
          </label>
          {tokenError && <p className="error">{tokenError}</p>}
          <button className="primary" disabled={submitting}>
            {submitting ? "…" : t("login.enter")}
          </button>
        </form>
        <details className="login-recovery">
          <summary>{t("login.magicRecovery")}</summary>
          <div className="magic-note">{t("login.magicNote")}</div>
          <form onSubmit={sendMagic}>
            <label>
              {t("login.email")}
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
                autoComplete="email"
              />
            </label>
            {magicError && <p className="error">{magicError}</p>}
            <button className="primary" disabled={submitting}>
              {submitting ? "…" : t("login.magic")}
            </button>
          </form>
          {magicSent && <p className="success">{t("login.sent")}</p>}
        </details>
        <p className="tiny">{t("login.invited")}</p>
      </section>
    </main>
  );
}

function UserAvatar({ src, name, size = "md" }: { src?: string; name?: string; size?: "sm" | "md" | "lg" }) {
  const label = (name || "E").trim().slice(0, 1).toUpperCase() || "E";
  return src ? (
    <img className={`avatar avatar-image avatar-${size}`} src={src} alt="" />
  ) : (
    <span className={`avatar avatar-${size}`}>{label}</span>
  );
}

function ProfileAvatarField({
  src,
  name,
  label,
  help,
  chooseLabel,
  removeLabel,
  onChange,
  onRemove,
}: {
  src?: string;
  name?: string;
  label: string;
  help: string;
  chooseLabel: string;
  removeLabel: string;
  onChange: (file?: File) => void | Promise<void>;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="profile-avatar-field">
      <button
        type="button"
        className="avatar-upload profile-avatar-button"
        onClick={() => fileRef.current?.click()}
        aria-label={chooseLabel}
      >
        <UserAvatar src={src} name={name} size="lg" />
        <span aria-hidden="true">✎</span>
      </button>
      <div className="profile-avatar-copy">
        <strong>{label}</strong>
        <p className="muted">{help}</p>
        <div className="profile-avatar-actions">
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            {chooseLabel}
          </button>
          {src && (
            <button type="button" className="text-link danger-link" onClick={onRemove}>
              {removeLabel}
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(event) => {
          void onChange(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function Onboarding() {
  const { session, refresh } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(session.displayName || "");
  const [bio, setBio] = useState(session.bio || "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(session.avatarUrl || "");
  const [busy, setBusy] = useState(false);
  const save = async (complete = true) => {
    setBusy(true);
    try {
      await api.saveProfile({ displayName, bio, avatarDataUrl, allowPublishingAs: false });
      await refresh();
      showToast(t("settings.profileSaved"));
      if (complete) nav("/", { replace: true });
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  };
  const chooseAvatar = async (file?: File) => {
    if (!file) return;
    try {
      setAvatarDataUrl(await fileAsBase64(file));
    } catch {
      showToast(t("editor.readImageError"), "error");
    }
  };
  return (
    <main className="onboarding-page">
      <div className="onboarding-shell">
        <div className="onboarding-brand brand"><AppBrand /></div>
        <div className="onboarding-progress" aria-label={`${step + 1} / 3`}>
          {[0, 1, 2].map((item) => <span key={item} className={item <= step ? "active" : ""} />)}
        </div>
        <p className="eyebrow">{t("onboarding.eyebrow")}</p>
        <h1>{t("onboarding.title")}</h1>
        {step === 0 && (
          <section className="onboarding-slide">
            <div className="onboarding-copy">
              <h2>{t("onboarding.profileTitle")}</h2>
              <p className="muted">{t("onboarding.profileHelp")}</p>
            </div>
            <ProfileAvatarField
              src={avatarDataUrl}
              name={displayName || session.email}
              label={t("settings.avatar")}
              help={t("settings.avatarHelp")}
              chooseLabel={t("settings.avatarChoose")}
              removeLabel={t("settings.avatarRemove")}
              onChange={chooseAvatar}
              onRemove={() => setAvatarDataUrl("")}
            />
            <label>{t("settings.displayName")}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("settings.displayNamePlaceholder")} autoFocus /></label>
            <label>{t("settings.bio")}<textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder={t("settings.bioPlaceholder")} rows={4} /></label>
          </section>
        )}
        {step === 1 && (
          <section className="onboarding-slide onboarding-permission-slide">
            <div className="onboarding-icon">✦</div>
            <h2>{t("onboarding.permissionsTitle")}</h2>
            <p className="muted">{t("onboarding.permissionsHelp")}</p>
            <div className="onboarding-delegation-note">
              <b>{t("onboarding.delegatesTitle")}</b>
              <p className="muted">{t("onboarding.delegatesHelp")}</p>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="onboarding-slide onboarding-tour-slide">
            <div className="onboarding-icon">◎</div>
            <h2>{t("onboarding.tourTitle")}</h2>
            <p className="muted">{t(session.role === "client_mcp" ? "mcp.help" : "onboarding.tourHelp")}</p>
            <div className="onboarding-tour-list">
              <span>✦<b>{t(session.role === "client_mcp" ? "mcp.connector" : "onboarding.tourAssistant")}</b></span>
              <span>▤<b>{t("onboarding.tourPosts")}</b></span>
              <span>□<b>{t("onboarding.tourCalendar")}</b></span>
            </div>
          </section>
        )}
        <div className="onboarding-actions">
          {step > 0 && <button type="button" className="secondary" onClick={() => setStep((value) => value - 1)}>{t("onboarding.back")}</button>}
          {step < 2 ? <button type="button" className="primary" onClick={() => setStep((value) => value + 1)}>{t("onboarding.next")}</button> : <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "…" : t("onboarding.finish")}</button>}
        </div>
        <button type="button" className="onboarding-skip" disabled={busy} onClick={() => void save()}>{t("onboarding.skip")}</button>
      </div>
    </main>
  );
}

function Shell() {
  const { session, site, sites, setSite, workflowFlags } = useApp();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const links = [
    { to: "/", label: t("nav.home"), icon: "home" },
    ...(workflowFlags.assistantEnabled ? [{ to: "/chat", label: t("nav.assistant"), icon: "assistant" }] : []),
    { to: "/posts", label: t("nav.posts"), icon: "posts" },
    { to: "/social-pack", label: t("nav.socialPack"), icon: "social" },
  ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-head">
          <NavLink to="/" className="brand">
            <AppBrand />
          </NavLink>
          <button
            className="icon-button close"
            onClick={() => setOpen(false)}
            aria-label={t("nav.close")}
          >
            ×
          </button>
        </div>
        <div className={`site-switcher ${sites.length < 2 ? "single" : ""}`}>
          <span className="site-switcher-label">{t("site.label")}</span>
          {sites.length > 1 ? (
            <ChoicePills
              value={site}
              ariaLabel={t("site.selector")}
              onChange={setSite}
              options={sites.map((handle) => ({ value: handle, label: handle }))}
            />
          ) : (
            <strong>● {site}</strong>
          )}
        </div>
        <CreditIndicator site={site} />
        {workflowFlags.assistantEnabled && (
          <button className="new-chat" onClick={() => nav("/chat")}>
            {t("nav.newChat")}
          </button>
        )}
        <nav>
          {links.map((link) => (
            <div className="nav-group" key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === "/"}
                className="nav-link"
              >
                <NavIcon kind={link.icon} />
                {link.label}
              </NavLink>
              {link.icon === "assistant" && <SidebarConversations site={site} />}
            </div>
          ))}
          {isAdmin(session.role) && (
            <NavLink to="/admin" className="nav-link">
              <NavIcon kind="admin" />
              {t("nav.admin")}
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/settings" className="profile">
            <UserAvatar src={session.avatarUrl} name={session.displayName || session.email || session.userId} size="sm" />
            <span>
              <b>{session.displayName || session.email || t("settings.workspace")}</b>
              <small>
                {t("settings.role")}: {roleLabel(session.role, t)}
              </small>
            </span>
            <span>···</span>
          </NavLink>
        </div>
      </aside>
      <button
        className={`backdrop ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
        aria-label={t("nav.close")}
      />
      <section className="workspace">
        <header className="mobile-head">
          <NavLink to="/" className="brand" aria-label="Escarlet CMS">
            <img className="brand-icon" src="/app/icon.png" alt="" />
          </NavLink>
          <span className="mobile-version">{t("app.beta")}</span>
        </header>
        <Outlet />
        <nav className="mobile-bottom-nav" aria-label={t("nav.mobile") || t("nav.open")}>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) => `mobile-bottom-link ${isActive ? "active" : ""}`}
            >
              <NavIcon kind={link.icon} />
              <span>{link.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={`mobile-menu-toggle ${open ? "open" : ""}`}
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? t("nav.close") : t("nav.open")}
            aria-expanded={open}
          >
            <span className="hamburger-lines" aria-hidden="true"><i /><i /><i /></span>
            <span>{t("nav.menu") || t("nav.open")}</span>
          </button>
        </nav>
      </section>
    </div>
  );
}

function SidebarConversations({ site }: { site: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const nav = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [deleting, setDeleting] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => api.aiConversations(site)
      .then((result) => active && setConversations(result.conversations || []))
      .catch(() => active && setConversations([]));
    void load();
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ site?: string }>).detail;
      if (!detail?.site || detail.site === site) void load();
    };
    window.addEventListener("escarlet:conversation-saved", onSaved);
    const onDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ site?: string }>).detail;
      if (!detail?.site || detail.site === site) void load();
    };
    const onArchived = (event: Event) => {
      const detail = (event as CustomEvent<{ site?: string }>).detail;
      if (!detail?.site || detail.site === site) void load();
    };
    window.addEventListener("escarlet:conversation-deleted", onDeleted);
    window.addEventListener("escarlet:conversation-archived", onArchived);
    return () => {
      active = false;
      window.removeEventListener("escarlet:conversation-saved", onSaved);
      window.removeEventListener("escarlet:conversation-deleted", onDeleted);
      window.removeEventListener("escarlet:conversation-archived", onArchived);
    };
  }, [site]);
  if (!conversations.length) return null;
  const removeConversation = async (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (deleting) return;
    if (!window.confirm(t("chat.deleteConfirm"))) return;
    setDeleting(id);
    try {
      await api.deleteAiConversation(id, site);
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      try {
        const storageKey = `escarlet_chat_threads:${site}`;
        const local = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(local)) {
          window.localStorage.setItem(storageKey, JSON.stringify(local.filter((thread) => thread?.id !== id)));
        }
        if (new URLSearchParams(location.search).get("conversation") === id) {
          window.localStorage.removeItem(`escarlet_chat_active:${site}`);
        }
      } catch {
        // Online deletion is authoritative; local fallback cleanup is best effort.
      }
      window.dispatchEvent(new CustomEvent("escarlet:conversation-deleted", { detail: { site, id } }));
      if (new URLSearchParams(location.search).get("conversation") === id) nav("/chat");
      showToast(t("chat.deleted"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("common.error"), "error");
    } finally {
      setDeleting("");
    }
  };
  return (
    <div className="sidebar-conversations">
      <span className="sidebar-conversations-label">{t("chat.history")}</span>
      {conversations.slice(0, 6).map((conversation) => (
        <div className="sidebar-conversation-row" key={conversation.id}>
          <NavLink
            to={`/chat?conversation=${encodeURIComponent(conversation.id)}`}
            className="sidebar-conversation"
            title={conversation.title}
          >
            <span>·</span>
            <span>{conversation.title || t("chat.newConversation")}</span>
          </NavLink>
          <button
            type="button"
            className="sidebar-conversation-delete"
            aria-label={`${t("chat.delete")} ${conversation.title || t("chat.newConversation")}`}
            title={t("chat.delete")}
            disabled={deleting === conversation.id}
            onClick={(event) => void removeConversation(event, conversation.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function NavIcon({ kind }: { kind: string }) {
  if (kind === "assistant") {
    return (
      <span className="nav-icon assistant-stars" aria-hidden="true">
        <i>✦</i><i>✦</i><i>✦</i>
      </span>
    );
  }
  if (kind === "posts") {
    return (
      <svg className="nav-icon" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <path d="M6.5 7.2h7M6.5 10h7M6.5 12.8h4.2" />
      </svg>
    );
  }
  if (kind === "social") {
    return (
      <svg className="nav-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2.8 12.1 7l4.6.7-3.3 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.3-3.3L7.9 7Z" />
        <path d="M10 5.4v5.1M7.5 9.2h5" />
      </svg>
    );
  }
  if (kind === "home") {
    return (
      <svg className="nav-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="m3.5 9 6.5-5 6.5 5v6.2a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3Z" />
        <path d="M8 16.5v-4h4v4" />
      </svg>
    );
  }
  if (kind === "admin") {
    return (
      <svg className="nav-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M8.1 3.4 8.6 2h2.8l.5 1.4 1.2.7 1.4-.4 2 2-0.5 1.4.7 1.2 1.4.5v2.8l-1.4.5-.7 1.2.5 1.4-2 2-1.4-.4-1.2.7-.5 1.4H8.6l-.5-1.4-1.2-.7-1.4.4-2-2 .5-1.4-.7-1.2-1.4-.5V8.3l1.4-.5.7-1.2-.5-1.4 2-2 1.4.4 1.2-.7Z" />
        <circle cx="10" cy="9.7" r="2.5" />
      </svg>
    );
  }
  return <span className="nav-icon nav-icon-glyph" aria-hidden="true">✦</span>;
}

function AdminActionIcon({ kind }: { kind: "edit" | "key" | "mail" | "trash" | "plus" }) {
  if (kind === "edit") {
    return <svg className="admin-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m13.9 3.1 3 3-8.8 8.8-4 1 1-4Z" /><path d="m11.8 5.2 3 3" /></svg>;
  }
  if (kind === "key") {
    return <svg className="admin-action-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.1" cy="12.9" r="3.2" /><path d="m9.5 10.5 6.1-6.1M13.7 6.3l1.7 1.7M11.9 8.1l1.4 1.4" /></svg>;
  }
  if (kind === "mail") {
    return <svg className="admin-action-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="m3.5 6 6.5 5 6.5-5" /></svg>;
  }
  if (kind === "trash") {
    return <svg className="admin-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.5h11M8 3.5h4l.7 3H7.3Z" /><path d="m6 6.5.7 10h6.6l.7-10M8.5 9.5v4.5M11.5 9.5v4.5" /></svg>;
  }
  return <svg className="admin-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v13M3.5 10h13" /></svg>;
}

function CreditIndicator({ site }: { site: string }) {
  const { session, workflowFlags } = useApp();
  const { t, language } = useI18n();
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (session.role !== "client_mcp" && !workflowFlags.cmsAiEnabled) {
      setSnapshot(null);
      setLoading(false);
      return () => {};
    }
    let active = true;
    setLoading(true);
    setSnapshot(null);
    api.billingSnapshot(site)
      .then((data) => active && setSnapshot(data))
      .catch(() => active && setSnapshot(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [site, session.role, workflowFlags.cmsAiEnabled]);
  const available = Number(snapshot?.ai?.tokenCredits?.available);
  const hasCredits = Number.isFinite(available);
  const displayCredits = hasCredits ? available.toLocaleString(language === "en" ? "en-GB" : "es-ES") : loading ? "…" : "—";
  if (session.role !== "client_mcp" && !workflowFlags.cmsAiEnabled) return null;
  if (session.role === "client_mcp") return <NavLink className="credit-indicator" to="/billing"><span>◈</span><span><b>{loading ? "…" : snapshot?.suspended ? t("mcp.readOnly") : t("mcp.membership")}</b><small>{snapshot ? `${Math.max(0, Number(snapshot.publishes?.limit || 0) - Number(snapshot.publishes?.used || 0))} ${t("mcp.publicationsLeft")}` : t("common.loading")}</small></span></NavLink>;
  return (
    <NavLink className="credit-indicator" to="/billing" title={t("billing.available")}>
      <span>✦</span>
      <span>
        <b>{displayCredits}</b>
        <small>{hasCredits ? t("billing.creditsLeft") : loading ? t("billing.creditsLoading") : t("billing.creditsUnavailable")}</small>
      </span>
    </NavLink>
  );
}

function Home() {
  const nav = useNavigate();
  const { session, site, workflowFlags } = useApp();
  const { t } = useI18n();
  return (
    <main className="page home">
      <div className="home-intro">
        <p className="eyebrow">{site}</p>
        <h1>{t("home.title")}</h1>
        <p className="muted">{t("home.description")}</p>
      </div>
      <div className="choice-grid">
        {workflowFlags.assistantEnabled && (
          <button className="choice-card ai" onClick={() => nav("/chat")}>
            <span className="assistant-stars home-assistant-stars" aria-hidden="true"><i>✦</i><i>✦</i><i>✦</i></span>
            <strong>{t("home.ai.title")}</strong>
            <small>{t("home.ai.description")}</small>
            <b>{t("home.ai.action")}</b>
          </button>
        )}
        {workflowFlags.blogWizardEnabled && (
          <button className="choice-card wizard" onClick={() => nav("/quick-create")}>
            <span>◉</span>
            <strong>{t("home.wizard.title")}</strong>
            <small>{t("home.wizard.description")}</small>
            <b>{t("home.wizard.action")}</b>
          </button>
        )}
        <button className="choice-card" onClick={() => nav("/social-pack")}>
          <span>✦</span>
          <strong>{t("home.social.title")}</strong>
          <small>{t("home.social.description")}</small>
          <b>{t("home.social.action")}</b>
        </button>
        <button className="choice-card" onClick={() => nav("/manual")}>
          <span>✎</span>
          <strong>{t("home.manual.title")}</strong>
          <small>{t("home.manual.description")}</small>
          <b>{t("home.manual.action")}</b>
        </button>
      </div>
      <section className="home-section">
        <div className="section-title">
          <h2>{t("home.continue")}</h2>
          <NavLink to="/posts">{t("home.seeAll")}</NavLink>
        </div>
        <RecentPosts />
        <div className="quick-actions">
          <button onClick={() => nav("/posts?status=scheduled&view=month")}>{t("home.calendar")}</button>
          {isAdmin(session.role) && (
            <button onClick={() => nav("/admin")}>{t("home.openAdmin")}</button>
          )}
        </div>
      </section>
    </main>
  );
}

function RecentPosts() {
  const { site } = useApp();
  const { t, language } = useI18n();
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .posts(site)
      .then((r) => {
        const newest = [...r.posts].sort(
          (a, b) =>
            new Date(b.dateModified || b.publishAt || b.datePublished || 0).getTime() -
            new Date(a.dateModified || a.publishAt || a.datePublished || 0).getTime(),
        );
        setPosts(newest.slice(0, 4));
      })
      .catch((e) => setError(e.message));
  }, [site]);
  if (error) return <p className="empty">{t("common.noPosts")}</p>;
  if (!posts.length)
    return (
      <p className="empty">
        {t("posts.empty")}. {t("posts.emptyAction")}.
      </p>
    );
  return (
    <div className="post-list compact">
      {posts.map((post) => (
        <PostRow key={post.slug} post={post} />
      ))}
    </div>
  );
}

type ChatMessage = { role: "assistant" | "user"; text: string };
type ChatThread = {
  id: string;
  site?: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

const chatThreadId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

function Chat() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", text: t("chat.greeting") }]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [value, setValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [lastBrief, setLastBrief] = useState("");
  const [conversationTitle, setConversationTitle] = useState(t("chat.newConversation"));
  const { site } = useApp();
  const { showToast } = useToast();
  const hydrationRequestRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const requestedConversationId = new URLSearchParams(location.search).get("conversation") || "";

  const storageKey = `escarlet_chat_threads:${site}`;
  const activeKey = `escarlet_chat_active:${site}`;
  useEffect(() => {
    hydrationRequestRef.current = site;
    let active = true;
    let localThreads: ChatThread[] = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(parsed)) {
        localThreads = parsed.filter((thread) => thread && typeof thread.id === "string" && Array.isArray(thread.messages));
      }
    } catch {
      localThreads = [];
    }
    const hydrate = async () => {
      let online: AiConversation[] = [];
      try {
        online = (await api.aiConversations(site)).conversations || [];
        // Migrate conversations created by the previous local-only version on
        // first visit, preserving their messages while moving the source of
        // truth to the server.
        const onlineIds = new Set(online.map((thread) => thread.id));
        const pending = localThreads.filter((thread) => !onlineIds.has(thread.id) && thread.messages.length);
        if (pending.length) {
          const migrated = await Promise.allSettled(pending.map((thread) => api.saveAiConversation({ ...thread, site })));
          for (const result of migrated) {
            if (result.status === "fulfilled") online = [result.value.conversation, ...online.filter((item) => item.id !== result.value.conversation.id)];
          }
        }
      } catch {
        // Keep a local fallback when the network is temporarily unavailable.
        online = [];
      }
      if (!active) return;
      const summaries: ChatThread[] = online.map((thread) => ({ ...thread, messages: [] }));
      const activeId = requestedConversationId || window.localStorage.getItem(activeKey) || online[0]?.id || localThreads[0]?.id || "";
      const localSelected = localThreads.find((thread) => thread.id === activeId);
      let selected: ChatThread | null = localSelected || null;
      if (activeId && !localSelected) {
        try {
          const result = await api.aiConversation(activeId, site);
          if (result.conversation) selected = { ...result.conversation, messages: result.conversation.messages || [] };
        } catch {
          selected = null;
        }
      }
      if (!selected) {
        selected = {
          id: activeId || chatThreadId(),
          title: t("chat.newConversation"),
          messages: [{ role: "assistant", text: t("chat.greeting") }],
          updatedAt: new Date().toISOString(),
        };
      }
      if (!summaries.some((thread) => thread.id === selected?.id)) summaries.unshift({ ...selected, messages: [] });
      setThreads(summaries.length ? summaries : [selected]);
      setActiveThreadId(selected.id);
      setConversationTitle(selected.title || t("chat.newConversation"));
      setMessages(selected.messages?.length ? selected.messages : [{ role: "assistant", text: t("chat.greeting") }]);
      setLastBrief([...selected.messages].reverse().find((message) => message.role === "user")?.text || "");
      window.localStorage.setItem(activeKey, selected.id);
      if (localThreads.length) window.localStorage.setItem(storageKey, JSON.stringify(localThreads));
    };
    void hydrate();
    return () => { active = false; };
  }, [site, requestedConversationId]);

  // Keep every conversation available after navigating away, reloading, or
  // returning to the assistant later. This is intentionally site-scoped.
  useEffect(() => {
    if (!activeThreadId || !site) return;
    // The hydration effect above and this persistence effect run in the same
    // commit after a site switch. Skip that first pass so the previous site's
    // messages cannot be written into the newly selected site's storage.
    if (hydrationRequestRef.current === site) {
      hydrationRequestRef.current = "";
      return;
    }
    const existing = threads.find((thread) => thread.id === activeThreadId);
    const nextThread: ChatThread = {
      id: activeThreadId,
      site,
      title: conversationTitle || existing?.title || t("chat.newConversation"),
      messages,
      updatedAt: new Date().toISOString(),
    };
    setThreads((current) => {
      const index = current.findIndex((thread) => thread.id === activeThreadId);
      if (index < 0) return [nextThread, ...current];
      const next = [...current];
      next[index] = { ...next[index], ...nextThread };
      return next;
    });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void api.saveAiConversation(nextThread)
        .then(() => window.dispatchEvent(new CustomEvent("escarlet:conversation-saved", { detail: { site } })))
        .catch(() => {
          // Keep a recoverable local copy if the server is briefly unavailable.
          window.localStorage.setItem(storageKey, JSON.stringify([nextThread]));
        });
    }, 280);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [messages, activeThreadId, site, requestedConversationId, conversationTitle]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" }));
    return () => window.cancelAnimationFrame(frame);
  }, [messages, activeThreadId]);

  const newConversation = () => {
    const thread: ChatThread = {
      id: chatThreadId(),
      title: t("chat.newConversation"),
      messages: [{ role: "assistant", text: t("chat.greeting") }],
      updatedAt: new Date().toISOString(),
    };
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setConversationTitle(thread.title || t("chat.newConversation"));
    setMessages(thread.messages);
    setLastBrief("");
    setValue("");
    nav("/chat");
  };

  const selectConversation = (thread: ChatThread) => {
    setActiveThreadId(thread.id);
    setConversationTitle(thread.title || t("chat.newConversation"));
    if (thread.messages.length) {
      setMessages(thread.messages);
      setLastBrief([...thread.messages].reverse().find((message) => message.role === "user")?.text || "");
    }
    setValue("");
    nav(`/chat?conversation=${encodeURIComponent(thread.id)}`);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const brief = value.trim();
    if (!brief) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: brief },
      { role: "assistant", text: "" },
    ]);
    setValue("");
    setCreating(true);
    setLastBrief(brief);
    const shouldGenerateTitle = !messages.some((message) => message.role === "user");
    try {
      const assistantText = await api.aiChat(
        {
          site,
          message: brief,
          model: localStorage.getItem("escarlet_model") || undefined,
        },
        (streamed) => {
          setMessages((prev) =>
            prev.map((message, index) =>
              index === prev.length - 1
                ? { ...message, text: streamed }
                : message,
            ),
          );
        },
      );
      if (shouldGenerateTitle && assistantText.trim()) {
        try {
          const titleResult = await api.aiGenerate({
            site,
            operation: "title",
            prompt: `Crea un título breve (máximo 60 caracteres) para esta conversación editorial. Devuelve solo el título, sin comillas ni explicación. Idea del usuario: ${brief}`,
            model: localStorage.getItem("escarlet_model") || undefined,
          });
          const generatedTitle = cleanGeneratedTitle(String(titleResult.content || ""));
          if (generatedTitle && !/^(t[ií]tulo sugerido|suggested title|propuesta editorial)/i.test(generatedTitle)) setConversationTitle(generatedTitle);
        } catch {
          // El texto de la conversación sigue disponible aunque el título no pueda generarse.
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("common.error"), "error");
      setMessages((prev) =>
        prev.map((message, index) =>
          index === prev.length - 1
            ? {
                ...message,
                text: `${t("common.error")} ${e instanceof Error ? e.message : ""}`.trim(),
              }
            : message,
        ),
      );
    } finally {
      setCreating(false);
    }
  };
  const createDraft = async () => {
    if (!lastBrief) return;
    setCreating(true);
    try {
      const assistantText = [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim())?.text || "";
      const prompt = `Convierte esta conversación en un artículo completo y útil. Idea inicial: ${lastBrief}\nRespuesta editorial del asistente: ${assistantText}`;
      const titleResult = await api.aiGenerate({
        site,
        operation: "title",
        prompt: `${prompt}\nDevuelve únicamente un título concreto, fiel al tema de la conversación, de máximo 72 caracteres. No uses etiquetas como «Título sugerido», no inventes otro tema y no añadas explicación.`,
        model: localStorage.getItem("escarlet_model") || undefined,
      });
      const generatedTitle = cleanGeneratedTitle(String(titleResult.content || ""));
      const fallbackTitle = cleanGeneratedTitle(conversationTitle && conversationTitle !== t("chat.newConversation") ? conversationTitle : lastBrief);
      const title = /^(t[ií]tulo sugerido|suggested title|propuesta editorial|borrador sugerido)/i.test(generatedTitle)
        ? (fallbackTitle || cleanGeneratedTitle(lastBrief))
        : (generatedTitle || fallbackTitle || cleanGeneratedTitle(lastBrief));
      const bodyResult = await api.aiGenerate({
        site,
        operation: "body",
        prompt: `${prompt}\nEl título definitivo es: ${title}\nDevuelve el cuerpo en Markdown, con subtítulos y varios párrafos. Mantén exactamente el tema y no incluyas comentarios sobre el proceso.`,
        model: localStorage.getItem("escarlet_model") || undefined,
      });
      const bodyContent = String(bodyResult.content || assistantText || `<p>${lastBrief}</p>`).trim();
      const summaryResult = await api.aiGenerate({
        site,
        operation: "summary",
        prompt: `Título: ${title}\nCuerpo del artículo:\n${bodyContent}\nDevuelve un resumen fiel de 1 o 2 frases para el listado. No inventes información ni cambies el tema.`,
        model: localStorage.getItem("escarlet_model") || undefined,
      });
      const metaResult = await api.aiGenerate({
        site,
        operation: "meta-description",
        prompt: `Título: ${title}\nResumen: ${String(summaryResult.content || "").trim()}\nCuerpo:\n${bodyContent}\nDevuelve una meta descripción SEO fiel de máximo 155 caracteres.`,
        model: localStorage.getItem("escarlet_model") || undefined,
      });
      const result = await api.createDraft({
        site,
        title,
        slug: slugify(title),
        contentSource: "client",
        assistantConversationId: activeThreadId,
      });
      const bodyHtml = bodyContent;
      const excerptEs = String(summaryResult.content || lastBrief).trim().slice(0, 500);
      const metaDescriptionEs = String(metaResult.content || excerptEs).replace(/^['"“”]+|['"“”]+$/g, "").trim().slice(0, 180);
      await api.updatePost({
        ...result.post,
        site,
        originalSlug: result.post.slug,
        slug: result.post.slug,
        bodyHtml,
        excerptEs,
        metaDescription: { ...(result.post.metaDescription || {}), es: metaDescriptionEs },
        direct: true,
      });
      try {
        const generatedImage = await api.generateImage({
          site,
          prompt: `${title}. ${excerptEs}`,
          slug: result.post.slug,
          title,
          alt: title,
        });
        const imageUrl = generatedImage.media?.url || generatedImage.media?.path || "";
        if (imageUrl) {
          await api.updatePost({
            site,
            originalSlug: result.post.slug,
            slug: result.post.slug,
            imageUrl,
            imageAlt: title,
            direct: true,
          });
        }
      } catch {
        showToast(t("chat.imageUnavailable"), "info");
      }
      showToast(t("chat.draftCreated"));
      nav(`/preview/${encodeURIComponent(result.post.slug)}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("common.error"), "error");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `${t("common.error")} ${e instanceof Error ? e.message : ""}`.trim(),
        },
      ]);
    } finally {
      setCreating(false);
    }
  };
  return (
    <main className="chat-page">
      <div className="chat-top">
        <div>
          <p className="eyebrow">{t("chat.eyebrow")}</p>
          <h1>{conversationTitle || t("chat.title")}</h1>
        </div>
        <div className="chat-top-actions">
          <button className="ghost" type="button" onClick={newConversation}>{t("chat.newConversation")}</button>
          <button className="ghost" type="button" onClick={() => {
            setLastBrief("");
            setMessages([{ role: "assistant", text: t("chat.reset") }]);
          }}>{t("chat.clear")}</button>
        </div>
      </div>
      <div className="messages">
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <span className="message-mark">
              {message.role === "assistant" ? "✦" : t("chat.you")}
            </span>
            <p>{message.text || "…"}</p>
          </div>
        ))}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>
      {lastBrief && (
        <div className="chat-actions">
          <button className="secondary draft-from-chat" disabled={creating} onClick={createDraft}>
            {t("chat.convert")}
          </button>
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("chat.placeholder")}
          rows={3}
        />
        <div>
          <small>{t("chat.context")}</small>
          <button className="primary" disabled={creating || !value.trim()}>
            {creating ? t("chat.thinking") : t("chat.send")}
          </button>
        </div>
      </form>
    </main>
  );
}

type QuickStep = 0 | 1 | 2 | 3;

function QuickCreate() {
  const { site } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState<QuickStep>(0);
  const [idea, setIdea] = useState("");
  const [draft, setDraft] = useState<Post | null>(null);
  const [socialPack, setSocialPack] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState<"draft" | "edit" | "image" | "publish" | "social" | "">("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordContextRef = useRef<"idea" | "edit">("idea");

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const transcribeBlob = async (blob: Blob) => {
    setTranscribing(true);
    setError("");
    try {
      const audioBase64 = await fileAsBase64(new File([blob], "escarlet-voice-note.webm", { type: blob.type || "audio/webm" }));
      const result = await api.transcribe({ site, audioBase64, mimeType: blob.type || "audio/webm", filename: "escarlet-voice-note.webm" });
      const text = result.text.trim();
      if (!text) return;
      if (recordContextRef.current === "idea") {
        setIdea((current) => `${current}${current ? " " : ""}${text}`.trim());
      } else {
        await reviseDraft(text);
      }
    } catch (value) {
      const reason = value instanceof Error ? value.message : t("wizard.error");
      setError(reason);
      showToast(reason, "error");
    } finally {
      setTranscribing(false);
    }
  };

  const startRecording = async (context: "idea" | "edit") => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const reason = t("wizard.voiceUnavailable", "Este navegador no permite dictado por voz.");
      setError(reason);
      showToast(reason, "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordContextRef.current = context;
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        stopStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size) void transcribeBlob(blob);
      };
      recorder.start();
      setRecording(true);
      setError("");
    } catch (value) {
      stopStream();
      const reason = value instanceof Error ? value.message : t("wizard.voiceError", "No se pudo acceder al micrófono.");
      setError(reason);
      showToast(reason, "error");
    }
  };

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopStream();
  }, []);

  const generateDraft = async () => {
    const brief = idea.trim();
    if (!brief) {
      setError(t("wizard.noIdea"));
      showToast(t("wizard.noIdea"), "error");
      return;
    }
    setBusy("draft");
    setError("");
    try {
      const model = localStorage.getItem("escarlet_model") || undefined;
      const titleResult = await api.aiGenerate({ site, operation: "title", prompt: `Crea un título concreto de máximo 72 caracteres para este artículo. Devuelve solo el título, sin comillas ni etiquetas. Idea: ${brief}`, model });
      const title = cleanGeneratedTitle(String(titleResult.content || brief));
      const bodyResult = await api.aiGenerate({ site, operation: "body", prompt: `Redacta un artículo completo en Markdown, con subtítulos y varios párrafos. Mantén exactamente esta idea y no hables del proceso: ${brief}\nTítulo: ${title}`, model });
      const body = String(bodyResult.content || brief).trim();
      const summaryResult = await api.aiGenerate({ site, operation: "summary", prompt: `Escribe un resumen de una o dos frases, fiel y sin inventar, para este artículo. Título: ${title}\nContenido: ${body}`, model });
      const excerpt = String(summaryResult.content || brief).trim().slice(0, 500);
      const metaResult = await api.aiGenerate({ site, operation: "meta-description", prompt: `Escribe una meta descripción SEO de máximo 155 caracteres para este artículo. Título: ${title}\nResumen: ${excerpt}\nContenido: ${body}`, model });
      const meta = String(metaResult.content || excerpt).replace(/^['"“”]+|['"“”]+$/g, "").trim().slice(0, 180);
      const created = await api.createDraft({ site, title, slug: slugify(title) || `borrador-${Date.now()}`, contentSource: "client" });
      const saved = await api.updatePost({
        ...created.post,
        site,
        originalSlug: created.post.slug,
        slug: created.post.slug,
        title,
        bodyHtml: body.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, " ").trim()}</p>`).join(""),
        excerptEs: excerpt,
        metaDescription: { ...(created.post.metaDescription || {}), es: meta },
        direct: true,
      });
      setDraft(saved.post);
      setStep(1);
      setMessage(t("wizard.saved"));
      showToast(t("wizard.saved"));
    } catch (value) {
      const reason = value instanceof Error ? value.message : t("wizard.error");
      setError(reason);
      showToast(reason, "error");
    } finally {
      setBusy("");
    }
  };

  async function reviseDraft(instruction: string) {
    if (!draft || !instruction.trim()) return;
    setBusy("edit");
    setError("");
    try {
      const model = localStorage.getItem("escarlet_model") || undefined;
      const context = `Título actual: ${draft.title}\nResumen actual: ${draft.excerptEs || ""}\nContenido actual:\n${String(draft.bodyHtml || "").replace(/<[^>]+>/g, " ")}\nCorrección solicitada: ${instruction}`;
      const titleResult = await api.aiGenerate({ site, operation: "title", prompt: `${context}\nDevuelve solo un título concreto de máximo 72 caracteres.`, model });
      const title = cleanGeneratedTitle(String(titleResult.content || draft.title));
      const bodyResult = await api.aiGenerate({ site, operation: "body", prompt: `${context}\nReescribe el artículo completo incorporando la corrección. Devuelve Markdown, sin comentarios.`, model });
      const body = String(bodyResult.content || draft.bodyHtml || "").trim();
      const summaryResult = await api.aiGenerate({ site, operation: "summary", prompt: `Resume fielmente este artículo en una o dos frases. Título: ${title}\nContenido: ${body}`, model });
      const excerpt = String(summaryResult.content || draft.excerptEs || "").trim().slice(0, 500);
      const saved = await api.updatePost({
        ...draft,
        site,
        originalSlug: draft.slug,
        slug: draft.slug,
        title,
        bodyHtml: body.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, " ").trim()}</p>`).join(""),
        excerptEs: excerpt,
        direct: true,
      });
      setDraft(saved.post);
      setMessage(t("wizard.saved"));
      showToast(t("wizard.saved"));
    } catch (value) {
      const reason = value instanceof Error ? value.message : t("wizard.error");
      setError(reason);
      showToast(reason, "error");
    } finally {
      setBusy("");
    }
  }

  const createImage = async () => {
    if (!draft?.slug) return;
    setBusy("image");
    setError("");
    try {
      const prompt = `${draft.title}. ${draft.excerptEs || ""}. ${String(draft.bodyHtml || "").replace(/<[^>]+>/g, " ").slice(0, 600)}`;
      const result = await api.generateImage({ site, postSlug: draft.slug, slug: draft.slug, title: draft.title, prompt, alt: draft.title, optionCount: 1 });
      const first = result.mediaOptions?.[0] || result.media;
      const refreshed = await api.post(draft.slug, site).catch(() => {
        const fallbackPost = { ...draft, imageUrl: first?.url || first?.path, imageAlt: first?.alt || draft.title } as Post;
        return { post: fallbackPost };
      });
      setDraft(refreshed.post);
      setStep(2);
      setMessage(t("wizard.imageTitle"));
      showToast(t("wizard.imageTitle"));
    } catch (value) {
      const reason = value instanceof Error ? value.message : t("wizard.error");
      setError(reason);
      showToast(reason, "error");
    } finally {
      setBusy("");
    }
  };

  const publish = async () => {
    if (!draft?.slug) return;
    setBusy("publish");
    setError("");
    try {
      const result = await api.publish(draft.slug, site, undefined, { ignoreSeo: true, direct: true });
      setDraft(result.post);
      setStep(3);
      setMessage(t("wizard.publishedTitle"));
      showToast(t("wizard.publishedTitle"));
    } catch (value) {
      const reason = value instanceof Error ? value.message : t("wizard.error");
      setError(reason);
      showToast(reason, "error");
    } finally {
      setBusy("");
    }
  };

  const generateSocial = async () => {
    if (!draft) return;
    setBusy("social");
    setError("");
    try {
      const onboarding = await api.onboarding(site).catch(() => ({}));
      const domain = String((onboarding as any)?.site?.domain || window.location.origin).replace(/\/$/, "");
      const articleUrl = `${domain}/blog/${draft.slug}`;
      const result = await api.aiGenerate({
        site,
        operation: "social-pack",
        prompt: `Genera el Social Media para el post publicado «${draft.title}». Incluye este enlace canónico donde corresponda: ${articleUrl}. No devuelvas enlaces de navegación ni explicaciones.`,
        post: { ...draft, articleUrl },
        asyncImages: true,
      });
      setSocialPack(result.socialPack || null);
      if (result.post) setDraft(result.post);
      if (result.socialPackJobId) {
        setMessage(t("social.generatingImages", "Generando imágenes del carrusel…"));
        const job = await waitForSocialPackJob(result.socialPackJobId, site);
        setSocialPack(job.socialPack || result.socialPack || null);
        if (job.post) setDraft(job.post);
        const warnings = job.warnings || [];
        const readyMessage = warnings.length ? warnings.join(" ") : t("wizard.socialReady");
        setMessage(readyMessage);
        showToast(readyMessage, warnings.length ? "error" : "success");
      } else {
        setMessage(t("wizard.socialReady"));
        showToast(t("wizard.socialReady"));
      }
    } catch (value) {
      const reason = value instanceof Error ? value.message : t("wizard.error");
      setError(reason);
      showToast(reason, "error");
    } finally {
      setBusy("");
    }
  };

  const updateDraftField = (key: "title" | "excerptEs" | "bodyHtml", value: string) => {
    setDraft((current) => current ? { ...current, [key]: key === "title" ? value.slice(0, MAX_EDITOR_TITLE_CHARS) : value } : current);
  };
  const stepLabels = [t("wizard.stepIdea"), t("wizard.stepReview"), t("wizard.stepImage"), t("wizard.stepPublish")];
  return (
    <main className="page narrow quick-create-page">
      <PageTitle eyebrow={t("wizard.eyebrow")} title={t("wizard.title")} description={t("wizard.description")} back />
      <div className="quick-progress" aria-label={stepLabels.join(", ")}>
        {stepLabels.map((label, index) => <span key={label} className={index <= step ? "active" : ""}><b>{index + 1}</b>{label}</span>)}
      </div>
      {step === 0 && (
        <section className="card quick-step-card">
          <label><b>{t("wizard.ideaLabel")}</b><textarea value={idea} onChange={(event) => setIdea(event.target.value)} rows={7} placeholder={t("wizard.ideaPlaceholder")} /></label>
          <div className="quick-record-row">
            <button type="button" className={recording ? "danger" : "secondary"} onClick={() => void startRecording("idea")} disabled={transcribing}>{recording ? t("wizard.stop") : t("wizard.record")}</button>
            {transcribing && <span className="muted">{t("wizard.transcribing")}</span>}
          </div>
          <button type="button" className="primary" onClick={() => void generateDraft()} disabled={busy !== "" || transcribing || !idea.trim()}>{busy === "draft" ? t("chat.thinking") : t("wizard.continue")}</button>
        </section>
      )}
      {step === 1 && draft && (
        <section className="card quick-step-card">
          <h2>{t("wizard.reviewTitle")}</h2>
          <p className="muted">{t("wizard.reviewHelp")}</p>
          <label><b>{t("wizard.titleLabel")}</b><input value={draft.title} maxLength={MAX_EDITOR_TITLE_CHARS} onChange={(event) => updateDraftField("title", event.target.value)} /></label>
          <label><b>{t("wizard.summaryLabel")}</b><textarea value={draft.excerptEs || ""} rows={3} onChange={(event) => updateDraftField("excerptEs", event.target.value)} /></label>
          <label><b>{t("wizard.bodyLabel")}</b><textarea className="wizard-body-input" value={String(draft.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim()} rows={12} onChange={(event) => updateDraftField("bodyHtml", event.target.value)} /></label>
          <div className="quick-record-row">
            <button type="button" className={recording ? "danger" : "secondary"} onClick={() => void startRecording("edit")} disabled={busy !== "" || transcribing}>{recording ? t("wizard.stop") : t("wizard.editVoice")}</button>
            <input className="quick-edit-input" placeholder={t("wizard.editPlaceholder")} onKeyDown={(event) => { if (event.key === "Enter" && event.currentTarget.value.trim()) { void reviseDraft(event.currentTarget.value.trim()); event.currentTarget.value = ""; } }} />
          </div>
          <div className="form-actions"><button type="button" className="ghost" onClick={() => nav("/posts")}>{t("common.back")}</button><button type="button" className="primary" disabled={Boolean(busy) || transcribing} onClick={() => void createImage()}>{busy === "image" ? t("chat.thinking") : t("wizard.createImage")}</button></div>
        </section>
      )}
      {step === 2 && draft && (
        <section className="card quick-step-card">
          <h2>{t("wizard.imageTitle")}</h2>
          <p className="muted">{t("wizard.imageHelp")}</p>
          {draft.imageUrl && <img className="quick-cover-image" src={draft.imageUrl} alt={draft.imageAlt || draft.title} />}
          <div className="form-actions"><button type="button" className="ghost" onClick={() => setStep(1)}>{t("common.back")}</button><button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void publish()}>{busy === "publish" ? t("publish.publishing") : t("wizard.publish")}</button></div>
        </section>
      )}
      {step === 3 && draft && (
        <section className="card quick-step-card">
          <h2>{t("wizard.publishedTitle")}</h2>
          <p className="muted">{t("wizard.publishedHelp")}</p>
          <div className="form-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void generateSocial()}>{busy === "social" ? t("publish.preparing") : t("wizard.generateSocial")}</button>{socialPack && <button type="button" className="ghost" onClick={() => nav(`/social-pack/${encodeURIComponent(draft.slug)}`)}>{t("wizard.openSocial")}</button>}</div>
          {socialPack && <div className="quick-social-preview">{Object.entries(socialPack).filter(([, value]) => typeof value === "string").slice(0, 3).map(([key, value]) => <article key={key}><b>{key}</b><p>{String(value)}</p></article>)}</div>}
        </section>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<Range | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value)
      editorRef.current.innerHTML = value || "";
  }, [value]);
  const command = (name: string, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, argument);
    onChange(editorRef.current?.innerHTML || "");
  };
  return (
    <div className="wysiwyg">
      <div
        className="wysiwyg-toolbar"
        role="toolbar"
        aria-label={t("editor.toolbar")}
      >
        <button
          type="button"
          aria-label={t("editor.bold")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("bold")}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          aria-label={t("editor.italic")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("italic")}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          aria-label={t("editor.heading")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("formatBlock", "h2")}
        >
          H2
        </button>
        <button
          type="button"
          aria-label={t("editor.list")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("insertUnorderedList")}
        >
          ☷
        </button>
        <button
          type="button"
          aria-label={t("common.linkUrl")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const selection = window.getSelection();
            selectionRef.current = selection?.rangeCount
              ? selection.getRangeAt(0).cloneRange()
              : null;
            setShowLinkModal(true);
          }}
        >
          ↗
        </button>
      </div>
      <div
        ref={editorRef}
        className="wysiwyg-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        suppressContentEditableWarning
      />
      {showLinkModal && (
        <LinkModal
          onClose={() => setShowLinkModal(false)}
          onApply={(url) => {
            editorRef.current?.focus();
            const selection = window.getSelection();
            selection?.removeAllRanges();
            if (selectionRef.current) selection?.addRange(selectionRef.current);
            command("createLink", url);
            setShowLinkModal(false);
          }}
        />
      )}
    </div>
  );
}

function LinkModal({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (url: string) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal-card compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-title"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">{t("common.linkUrl")}</p>
            <h2 id="link-modal-title">{t("editor.linkTitle")}</h2>
            <p className="muted">{t("editor.linkDescription")}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={t("editor.close")}
          >
            ×
          </button>
        </div>
        <label className="modal-field">
          {t("common.linkUrl")}
          <input
            autoFocus
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("editor.linkPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) onApply(url.trim());
            }}
          />
        </label>
        <div className="form-actions">
          <button className="ghost" type="button" onClick={onClose}>
            {t("editor.close")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={!url.trim()}
            onClick={() => onApply(url.trim())}
          >
            {t("editor.linkApply")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ConfirmModal({
  title,
  description,
  confirmLabel,
  busy = false,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal-card compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">{t("common.confirm")}</p>
            <h2 id="confirm-modal-title">{title}</h2>
            <p className="muted">{description}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={t("editor.close")}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="form-actions">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            {t("editor.close")}
          </button>
          <button className="danger-button compact-danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? t("admin.saving") : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function ReferenceMediaModal({
  media,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  media: MediaItem;
  busy: boolean;
  onClose: () => void;
  onSave: (alt: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [alt, setAlt] = useState(media.alt || "");
  const imageSrc = media.url || media.path || media.thumbUrl || media.thumbPath || "";
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="modal-card reference-modal" role="dialog" aria-modal="true" aria-labelledby="reference-modal-title">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{t("admin.referencesEyebrow")}</p>
            <h2 id="reference-modal-title">{t("admin.referenceEditTitle")}</h2>
            <p className="muted">{t("admin.referenceEditHelp")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label={t("editor.close")}>×</button>
        </div>
        <div className="reference-modal-preview">
          {imageSrc ? <img src={imageSrc} alt={alt || t("admin.referenceImage")} /> : <span>✦</span>}
        </div>
        <div className="reference-modal-meta">
          <span className="reference-badge">✦ {t("admin.referenceBadge")}</span>
          <span className="tiny">{media.filename || t("admin.referenceImage")}</span>
        </div>
        <label className="modal-field">
          {t("admin.referenceAlt")}
          <textarea value={alt} onChange={(event) => setAlt(event.target.value)} rows={3} autoFocus />
        </label>
        <div className="form-actions">
          <button className="danger-link" type="button" onClick={onDelete} disabled={busy}>{t("admin.delete")}</button>
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>{t("editor.close")}</button>
          <button className="primary" type="button" onClick={() => onSave(alt.trim())} disabled={busy}>
            {busy ? t("admin.saving") : t("admin.save")}
          </button>
        </div>
      </section>
    </div>
  );
}

function BrandAiModal({
  file,
  current,
  busy,
  onClose,
  onGenerate,
}: {
  file: string;
  current: string;
  busy: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section className="modal-card compact-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{t("admin.brandAiEyebrow")}</p>
            <h2>{t("admin.brandAiTitle")}</h2>
            <p className="muted">{file} · {t("admin.brandAiHelp")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label={t("editor.close")}>×</button>
        </div>
        <label className="modal-field">
          {t("admin.brandAiPrompt")}
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("admin.brandAiPlaceholder")}
            rows={4}
          />
        </label>
        <p className="tiny">{t("admin.brandAiCurrent")} {current.slice(0, 180)}{current.length > 180 ? "…" : ""}</p>
        <div className="form-actions">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>{t("editor.close")}</button>
          <button className="primary" type="button" onClick={() => onGenerate(prompt.trim())} disabled={busy || !prompt.trim()}>
            {busy ? t("admin.saving") : t("admin.brandAiAction")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ImageGenerationModal({
  onClose,
  onGenerate,
  busy,
}: {
  onClose: () => void;
  onGenerate: (
    mode: "content" | "description" | "both",
    prompt: string,
    optionCount: number,
  ) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"content" | "description" | "both">("both");
  const [prompt, setPrompt] = useState("");
  const [optionCount, setOptionCount] = useState(1);
  const choices = [
    {
      id: "content" as const,
      title: t("editor.useContent"),
      help: t("editor.useContentHelp"),
    },
    {
      id: "description" as const,
      title: t("editor.useDescription"),
      help: t("editor.useDescriptionHelp"),
    },
    {
      id: "both" as const,
      title: t("editor.useBoth"),
      help: t("editor.useBothHelp"),
    },
  ];
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal-card image-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-modal-title"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">{t("editor.image")}</p>
            <h2 id="image-modal-title">{t("editor.imageQuestion")}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("editor.close")}
          >
            ×
          </button>
        </div>
        <div className="image-mode-grid">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`image-mode-card ${mode === choice.id ? "selected" : ""}`}
              onClick={() => setMode(choice.id)}
            >
              <strong>{choice.title}</strong>
              <small>{choice.help}</small>
            </button>
          ))}
        </div>
        {(mode === "description" || mode === "both") && (
          <label className="modal-field image-prompt-field">
            {t("editor.imagePrompt")}
            <textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t("editor.imagePromptPlaceholder")}
            />
          </label>
        )}
        <fieldset className="image-option-picker">
          <legend>{t("editor.imageOptions")}</legend>
          <p className="optional">{t("editor.imageOptionsHelp")}</p>
          <div className="choice-pills" role="radiogroup" aria-label={t("editor.imageOptions")}>
            {[1, 2, 3].map((count) => (
              <button
                key={count}
                type="button"
                className={`choice-pill ${optionCount === count ? "selected" : ""}`}
                aria-pressed={optionCount === count}
                onClick={() => setOptionCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="form-actions">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            {t("editor.close")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={
              busy ||
              ((mode === "description" || mode === "both") && !prompt.trim())
            }
            onClick={() => onGenerate(mode, prompt, optionCount)}
          >
            {busy ? t("editor.saving") : t("editor.generate")}
          </button>
        </div>
      </section>
    </div>
  );
}

function AiSuggestionModal({
  operation,
  busy,
  onClose,
  onGenerate,
}: {
  operation: "title" | "summary" | "body" | "humanize" | "meta";
  busy: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const labels: Record<typeof operation, string> = {
    title: t("editor.title"),
    summary: t("editor.excerpt"),
    body: t("editor.content"),
    humanize: t("editor.humanize"),
    meta: t("editor.meta"),
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal-card compact-modal" role="dialog" aria-modal="true" aria-labelledby="ai-suggestion-title">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{t("editor.aiSuggestionEyebrow")}</p>
            <h2 id="ai-suggestion-title">{t("editor.aiSuggestionTitle")} · {labels[operation]}</h2>
            <p className="muted">{t("editor.aiSuggestionHelp")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label={t("editor.close")}>×</button>
        </div>
        <label className="modal-field">
          {t("editor.aiSuggestionPrompt")}
          <textarea autoFocus rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("editor.aiSuggestionPlaceholder")} />
        </label>
        <div className="form-actions">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>{t("editor.close")}</button>
          <button className="primary" type="button" onClick={() => onGenerate(prompt.trim())} disabled={busy || (operation !== "humanize" && !prompt.trim())}>{busy ? t("editor.saving") : t("editor.generateContent")}</button>
        </div>
      </section>
    </div>
  );
}

function ManualPost() {
  const nav = useNavigate();
  const { site, session } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const { slug: editSlug = "" } = useParams();
  const storageKey = `escarlet_draft_${site}_${editSlug || "new"}`;
  const [draft, setDraft] = useState<Draft>({
    title: "",
    slug: "",
    excerptEs: "",
    bodyHtml: "<p></p>",
    metaDescription: { es: "" },
    authorName: "",
  });
  const [authors, setAuthors] = useState<Author[]>([]);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<
    "title" | "summary" | "body" | "humanize" | "meta" | "image" | null
  >(null);
  const [error, setError] = useState("");
  const [seoMessage, setSeoMessage] = useState("");
  const [seoValid, setSeoValid] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [aiPromptOperation, setAiPromptOperation] = useState<"title" | "summary" | "body" | "humanize" | "meta" | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [slugEdited, setSlugEdited] = useState(Boolean(editSlug));
  const [draftRecovered, setDraftRecovered] = useState(false);
  const serverDraftKey = `${storageKey}_server`;
  const [serverDraftSlug, setServerDraftSlug] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem(serverDraftKey) || "",
  );
  const [galleryQuery, setGalleryQuery] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let active = true;
    api.authors(site)
      .catch(() => ({ authors: [] }))
      .then((authorData) => {
        if (!active) return;
        const source = authorData.authors || [];
        const seen = new Set<string>();
        setAuthors(
          source.map((author) =>
            typeof author === "string" ? { name: author } : author,
          ).filter((author) => {
            const key = author.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [site]);
  useEffect(() => {
    let active = true;
    if (!editSlug) {
      const raw = localStorage.getItem(storageKey);
      if (raw)
        try {
          const stored = JSON.parse(raw);
          if (active) {
            setDraft((current) => ({ ...current, ...stored }));
            setDraftRecovered(true);
          }
        } catch {
          /* ignore local draft */
        }
      return () => {
        active = false;
      };
    }
    api
      .post(editSlug, site)
      .then(({ post }) => {
        if (active) {
          setDraft({
            ...post,
            title: post.title || "",
            slug: post.slug,
            bodyHtml: post.bodyHtml || "<p></p>",
            metaDescription: post.metaDescription || { es: "" },
          });
          if (post.publishAt) {
            const scheduled = new Date(post.publishAt);
            if (!Number.isNaN(scheduled.getTime())) {
              setScheduleDate(scheduled.toISOString().slice(0, 10));
              setScheduleTime(scheduled.toISOString().slice(11, 16));
            }
          }
          setSlugEdited(
            Boolean(post.slug && post.slug !== slugify(post.title || "")),
          );
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [editSlug, site, storageKey]);
  useEffect(() => {
    if (draft.title || draft.excerptEs || draft.bodyHtml !== "<p></p>" || draft.imageGallery?.length || draft.imageUrl)
      localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);
  const update = (key: keyof Draft, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateTitle = (title: string) =>
    setDraft((current) => ({
      ...current,
      title: title.slice(0, MAX_EDITOR_TITLE_CHARS),
      slug: slugEdited ? current.slug : slugify(title.slice(0, MAX_EDITOR_TITLE_CHARS)),
    }));
  const generate = async (operation: "title" | "summary" | "body" | "humanize" | "meta", requestedPrompt = "") => {
    setError("");
    setGenerating(operation);
    try {
      const prompt = operation === "humanize" ? requestedPrompt : requestedPrompt || (
        operation === "meta"
          ? `Escribe una meta descripción SEO de 70 a 180 caracteres para este post. Título: ${draft.title}. Contenido: ${draft.bodyHtml}`
          : operation === "summary"
            ? `Escribe un resumen de una sola frase, claro y atractivo, para el listado del blog. Título: ${draft.title}. Contenido: ${draft.bodyHtml}`
            : draft.title || draft.excerptEs || "Propón contenido para este post"
      );
      const result = await api.aiGenerate({
        site,
        operation: operation === "meta" ? "meta-description" : operation,
        prompt,
        post: draft,
        model: localStorage.getItem("escarlet_model") || undefined,
      });
      if (operation === "title") {
        const title = cleanGeneratedTitle(result.content || "");
        if (!title) throw new Error(t("editor.titleRequired"));
        updateTitle(title);
      }
      else if (operation === "summary")
        update("excerptEs", (result.content || "").slice(0, 220));
      else if (operation === "body" || operation === "humanize")
        (() => {
          const generatedBody = String(result.content || "").trim();
          const bodyHtml = /<(?:p|h[1-6]|ul|ol|li|blockquote|br)\b/i.test(generatedBody)
            ? generatedBody
            : `<p>${generatedBody.replace(/\n+/g, "</p><p>")}</p>`;
          update("bodyHtml", bodyHtml);
        })();
      else
        update("metaDescription", {
          ...(draft.metaDescription || {}),
          es: (result.content || "").slice(0, 180),
        });
    } catch (e) {
      const message = e instanceof Error ? e.message : t("common.error");
      setError(message);
      showToast(message, "error");
    } finally {
      setGenerating(null);
      setAiPromptOperation(null);
    }
  };
  const handleUpload = async (file?: File) => {
    if (!file) return;
    setImageBusy(true);
    setError("");
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(t("editor.readImageError")));
        reader.readAsDataURL(file);
      });
      const result = await api.uploadMedia({
        site,
        filename: file.name,
        contentBase64,
        alt: draft.imageAlt || draft.title,
        kind: "post",
      });
      update("imageUrl", result.media.url || result.media.path || "");
      update(
        "imageThumbUrl",
        result.media.thumbUrl || result.media.thumbPath || "",
      );
      update("imageAlt", result.media.alt || draft.imageAlt || draft.title || file.name.replace(/\.[^.]+$/, ""));
      update("imageGallery", [...(draft.imageGallery || []), result.media]);
    } catch (e) {
      const message = e instanceof Error ? e.message : t("common.error");
      setError(message);
      showToast(message, "error");
    } finally {
      setImageBusy(false);
    }
  };
  const ensureServerDraft = async () => {
    if (editSlug) return editSlug;
    if (serverDraftSlug) return serverDraftSlug;
    const title = draft.title.trim() || t("editor.imageDraftTitle");
    const slug = draft.slug || slugify(title) || `borrador-${Date.now()}`;
    const created = await api.createDraft({
      site,
      title,
      slug,
      authorName: draft.authorName || authors[0]?.name || session.displayName || session.email || "Escarlet",
      contentSource: "client",
    });
    setServerDraftSlug(created.post.slug);
    localStorage.setItem(serverDraftKey, created.post.slug);
    setDraft((current) => ({
      ...current,
      slug: current.slug || created.post.slug,
      status: created.post.status,
    }));
    return created.post.slug;
  };
  const generateImage = async (
    mode: "content" | "description" | "both",
    description: string,
    optionCount = 1,
  ) => {
    setImageBusy(true);
    setError("");
    try {
      const content =
        `${draft.title}\n${draft.excerptEs || ""}\n${draft.bodyHtml || ""}`.replace(
          /<[^>]+>/g,
          " ",
        );
      const prompt =
        mode === "content"
          ? content
          : mode === "description"
            ? description
            : `${content}\nDirección adicional: ${description}`;
      const postSlug = await ensureServerDraft();
      const result = await api.generateImage({
        site,
        prompt,
        slug: draft.slug || slugify(draft.title),
        postSlug,
        optionCount,
        title: draft.title,
        alt: draft.imageAlt || draft.title,
      });
      const options = result.mediaOptions?.length ? result.mediaOptions : [result.media];
      const first = options[0];
      setDraft((current) => {
        const existing = current.imageGallery || [];
        const merged = [...existing, ...options]
          .filter((item, index, list) => {
            const key = item.url || item.path || item.id;
            return key
              ? list.findIndex((candidate) => (candidate.url || candidate.path || candidate.id) === key) === index
              : true;
          })
          .slice(-30);
        return {
          ...current,
          imageUrl: current.imageUrl || first?.url || first?.path || "",
          imageThumbUrl: current.imageThumbUrl || first?.thumbUrl || first?.thumbPath || "",
          imageAlt: current.imageAlt || first?.alt || current.title || t("editor.imageAltPlaceholder"),
          imageGallery: result.gallery?.length ? result.gallery : merged,
        };
      });
      setShowImageModal(false);
      showToast(options.length > 1 ? t("editor.imagesReady", `${options.length} imágenes listas para elegir.`) : t("editor.imageReady"));
    } catch (e) {
      const message = e instanceof Error ? e.message : t("common.error");
      setError(message);
      showToast(message, "error");
    } finally {
      setImageBusy(false);
    }
  };
  const validateSeo = async () => {
    setSeoMessage("");
    setSeoValid(false);
    try {
      const result = await api.validateSeo({
        site,
        slug: editSlug || draft.slug,
        post: draft,
      });
      setSeoValid(Boolean(result.ok));
      setSeoMessage(
        result.ok
          ? t("common.seoValid")
          : `${((result.errors as string[]) || []).join(" ")}`,
      );
    } catch (e) {
      setSeoMessage(e instanceof Error ? e.message : t("common.error"));
    }
  };
  const galleryImages = (draft.imageGallery || []).filter((image) => {
    const query = galleryQuery.trim().toLowerCase();
    if (!query) return true;
    return [image.alt, image.filename, image.prompt, image.generatedAt]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const useGalleryImage = (image: NonNullable<Draft["imageGallery"]>[number]) => {
    update("imageUrl", image.url || image.path || "");
    update("imageThumbUrl", image.thumbUrl || image.thumbPath || "");
    update("imageAlt", image.alt || draft.title || t("editor.imageAltPlaceholder"));
    showToast(t("editor.imageSelected"));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const slug = draft.slug || slugify(draft.title);
      const hasSchedule = Boolean(draft.publishAt) || draft.status === "scheduled" || draft.status === "pending_schedule";
      const nextPublishAt = hasSchedule && scheduleDate
        ? new Date(`${scheduleDate}T${scheduleTime || "09:00"}`).toISOString()
        : draft.publishAt;
      let saved: { post: Post };
      const originalSlug = editSlug || serverDraftSlug;
      if (originalSlug)
        saved = await api.updatePost({
          ...draft,
          site,
          originalSlug,
          slug,
          direct: true,
          publishAt: nextPublishAt,
          status: originalSlug && draft.status === "published" ? "draft" : draft.status,
          title: draft.title,
          authorName: draft.authorName || authors[0]?.name || session.displayName || session.email || "Escarlet",
          bodyHtml: draft.bodyHtml,
          metaTitle: { ...(draft.metaTitle || {}), es: draft.title },
        });
      else {
        const created = await api.createDraft({
          site,
          title: draft.title,
          slug,
          authorName: draft.authorName || authors[0]?.name || session.displayName || session.email || "Escarlet",
          contentSource: "client",
        });
        saved = await api.updatePost({
          ...created.post,
          ...draft,
          site,
          originalSlug: created.post.slug,
          slug,
          direct: true,
          publishAt: nextPublishAt,
          title: draft.title,
          authorName: draft.authorName || authors[0]?.name || session.displayName || session.email || "Escarlet",
          bodyHtml: draft.bodyHtml,
          metaTitle: { es: draft.title },
        });
      }
      localStorage.removeItem(storageKey);
      localStorage.removeItem(serverDraftKey);
      showToast(t("editor.saved"));
      nav(`/preview/${encodeURIComponent(saved.post.slug)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
      showToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="page form-page">
      <PageTitle
        eyebrow={t("editor.eyebrow")}
        title={t("editor.title")}
        description={t("editor.description")}
        back
      />
      {draftRecovered && !editSlug && (
        <div className="draft-recovery" role="status">
          <span>↺</span>
          <div>
            <strong>{t("editor.draftRecovered")}</strong>
            <p>{t("editor.draftRecoveredHelp")}</p>
          </div>
          <button
            type="button"
            className="danger-link"
            onClick={() => {
              localStorage.removeItem(storageKey);
              localStorage.removeItem(serverDraftKey);
              setDraft({ title: "", slug: "", excerptEs: "", bodyHtml: "<p></p>", metaDescription: { es: "" }, authorName: "" });
              setDraftRecovered(false);
            }}
          >
            {t("editor.discardDraft")}
          </button>
        </div>
      )}
      <form onSubmit={submit} className="editor-form">
        <label>
          {t("editor.title")}{" "}
          <AiOnly><button
            type="button"
            className="inline-ai"
            onClick={() => setAiPromptOperation("title")}
            disabled={Boolean(generating)}
          >
            {generating === "title" ? "…" : t("editor.suggestTitle")}
          </button></AiOnly>
          <input
            required
            maxLength={MAX_EDITOR_TITLE_CHARS}
            value={draft.title}
            onChange={(e) => updateTitle(e.target.value)}
            placeholder={t("editor.titlePlaceholder")}
          />
        </label>
        <label>
          {t("editor.slug")}{" "}
          <span className="optional">{t("editor.slugAuto")}</span>
          <input
            value={draft.slug || ""}
            onChange={(e) => {
              setSlugEdited(true);
              update("slug", slugify(e.target.value));
            }}
            placeholder={t("editor.slugPlaceholder")}
          />
        </label>
        <label>
          {t("editor.excerpt")}{" "}
          <AiOnly><button
            type="button"
            className="inline-ai"
            onClick={() => setAiPromptOperation("summary")}
            disabled={Boolean(generating)}
          >
            {generating === "summary" ? "…" : t("editor.generateExcerpt")}
          </button></AiOnly>
          <input
            value={draft.excerptEs || ""}
            onChange={(e) => update("excerptEs", e.target.value)}
            placeholder={t("editor.excerptPlaceholder")}
          />
        </label>
        <fieldset className="author-picker">
          <legend>{t("editor.author")}</legend>
          <div
            className="author-pills"
            role="radiogroup"
            aria-label={t("editor.author")}
          >
            {authors.length ? (
              authors.map((author) => {
                const selected =
                  draft.authorName === author.name ||
                  (!draft.authorName && authors[0]?.name === author.name);
                return (
                  <button
                    key={author.id || author.name}
                    type="button"
                    className={`author-pill ${selected ? "selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => update("authorName", author.name)}
                  >
                    {author.avatarUrl ? <img src={author.avatarUrl} alt="" /> : <span className="author-pill-avatar">{author.name.slice(0, 1).toUpperCase()}</span>}
                    {author.name}
                  </button>
                );
              })
            ) : (
              <span className="optional">{t("editor.authorPlaceholder")}</span>
            )}
          </div>
        </fieldset>
        {(Boolean(draft.publishAt) || draft.status === "scheduled" || draft.status === "pending_schedule") && (
          <section className="date-picker-card editor-schedule-card">
            <div className="date-picker-heading">
              <div>
                <p className="eyebrow">{t("editor.scheduleDate")}</p>
                <span className="optional">{t("editor.scheduleDateHelp")}</span>
              </div>
              <span>◷</span>
            </div>
            <div className="date-picker-fields">
              <CalendarDatePicker
                value={scheduleDate}
                onChange={setScheduleDate}
                min={new Date().toISOString().slice(0, 10)}
              />
              <label>
                {t("schedule.time")}
                <input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} />
              </label>
            </div>
          </section>
        )}
        <label>
          {t("editor.content")}{" "}
          <AiOnly><button
            type="button"
            className="inline-ai"
            onClick={() => setAiPromptOperation("body")}
            disabled={Boolean(generating)}
          >
            {generating === "body" ? "…" : t("editor.writeWithAi")}
          </button></AiOnly>
          <AiOnly><button
            type="button"
            className="inline-ai"
            onClick={() => setAiPromptOperation("humanize")}
            hidden={!String(draft.bodyHtml || "").replace(/<[^>]+>/g, " ").trim()}
            disabled={Boolean(generating)}
          >
            {generating === "humanize" ? "…" : t("editor.humanize")}
          </button></AiOnly>
          <span className="optional">{t("editor.contentHelp")}</span>
          <RichTextEditor
            value={draft.bodyHtml || ""}
            onChange={(value) => update("bodyHtml", value)}
            placeholder={t("editor.contentPlaceholder")}
          />
        </label>
        <section className="media-field">
          <div className="field-heading">
            <div>
              <label>{t("editor.image")}</label>
              <p className="optional">{t("editor.imageHelp")}</p>
            </div>
            <div className="media-actions">
              <AiOnly><button
                type="button"
                className="secondary"
                onClick={() => setShowImageModal(true)}
                disabled={imageBusy}
              >
                {t("editor.generateImage")}
              </button></AiOnly>
              <button
                type="button"
                className="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={imageBusy}
              >
                {t("editor.uploadImage")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => void handleUpload(e.target.files?.[0])}
              />
            </div>
          </div>
          {draft.imageUrl ? (
            <div className="cover-preview">
              <img
                src={draft.imageThumbUrl || draft.imageUrl}
                alt={draft.imageAlt || ""}
              />
              <button
                type="button"
                className="danger-link"
                aria-label={t("editor.removeImage")}
                onClick={() => {
                  update("imageUrl", "");
                  update("imageThumbUrl", "");
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="upload-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleUpload(e.dataTransfer.files?.[0]);
              }}
            >
              <span>＋</span>
              <strong>{t("editor.chooseImage")}</strong>
              <small>{t("editor.imageHelp")}</small>
            </button>
          )}
          {draft.imageGallery?.length ? (
            <section className="generated-gallery" aria-labelledby="generated-gallery-title">
              <div className="field-heading">
                <div>
                  <label id="generated-gallery-title">{t("editor.imageGallery")}</label>
                  <p className="optional">{t("editor.imageGalleryHelp")}</p>
                </div>
                <span className="tiny">{draft.imageGallery.length}</span>
              </div>
              <input
                className="gallery-search"
                value={galleryQuery}
                onChange={(event) => setGalleryQuery(event.target.value)}
                placeholder={t("editor.imageGallerySearch")}
                aria-label={t("editor.imageGallerySearch")}
              />
              {galleryImages.length ? (
                <div className="generated-gallery-grid">
                  {galleryImages.map((image, index) => {
                    const imageSrc = image.thumbUrl || image.thumbPath || image.url || image.path || "";
                    const selected = imageSrc && imageSrc === (draft.imageThumbUrl || draft.imageUrl);
                    return (
                      <article className={`generated-image-card ${selected ? "selected" : ""}`} key={image.url || image.path || image.id || `${image.generatedAt}-${index}`}>
                        {imageSrc ? <img src={imageSrc} alt={image.alt || ""} /> : <div className="generated-image-empty">{t("editor.imageUnavailable")}</div>}
                        <div className="generated-image-card-body">
                          <span className="tiny">{image.generatedAt ? readableDate(image.generatedAt) : t("editor.imageUploaded")}</span>
                          <button type="button" className="ghost" onClick={() => useGalleryImage(image)} disabled={!imageSrc}>
                            {selected ? t("editor.imageSelectedLabel") : t("editor.useImage")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : <p className="optional">{t("editor.imageGalleryEmpty")}</p>}
            </section>
          ) : null}
          <label>
            {t("editor.imageAlt")}
            <input
              value={draft.imageAlt || ""}
              onChange={(e) => update("imageAlt", e.target.value)}
              placeholder={t("editor.imageAltPlaceholder")}
            />
          </label>
        </section>
        <label>
          {t("editor.meta")}{" "}
          <AiOnly><button
            type="button"
            className="inline-ai"
            onClick={() => setAiPromptOperation("meta")}
            disabled={Boolean(generating)}
          >
            {generating === "meta" ? "…" : t("editor.generateMeta")}
          </button></AiOnly>
          <span className="optional">{t("editor.metaHelp")}</span>
          <input
            value={draft.metaDescription?.es || ""}
            onChange={(e) =>
              update("metaDescription", {
                ...(draft.metaDescription || {}),
                es: e.target.value,
              })
            }
            maxLength={180}
            placeholder={t("editor.metaPlaceholder")}
          />
        </label>
        {seoMessage && (
          <p className={seoValid ? "success" : "error"}>{seoMessage}</p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={() => nav(-1)}>
            {t("editor.cancel")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void validateSeo()}
          >
            {t("editor.seoCheck")}
          </button>
          <button className="primary" disabled={saving || imageBusy}>
            {saving ? t("editor.saving") : t("editor.save")}
          </button>
        </div>
      </form>
      {showImageModal && (
        <ImageGenerationModal
          onClose={() => setShowImageModal(false)}
          onGenerate={(mode, prompt, optionCount) => void generateImage(mode, prompt, optionCount)}
          busy={imageBusy}
        />
      )}
      {aiPromptOperation && (
        <AiSuggestionModal
          operation={aiPromptOperation}
          busy={Boolean(generating)}
          onClose={() => setAiPromptOperation(null)}
          onGenerate={(prompt) => void generate(aiPromptOperation, prompt)}
        />
      )}
    </main>
  );
}

function Preview() {
  const { slug = "" } = useParams();
  const nav = useNavigate();
  const { site } = useApp();
  const { t, language } = useI18n();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .post(slug, site)
      .then((r) => setPost(r.post))
      .catch((e) => setError(e.message));
  }, [slug, site]);
  if (error)
    return (
      <main className="page">
        <p className="error">{error}</p>
      </main>
    );
  if (!post) return <Loading />;
  return (
    <main className="preview-page">
      <div className="preview-head">
        <div>
          <BackButton />
          <p className="eyebrow">{t("preview.eyebrow")}</p>
          <h1>{t("preview.title")}</h1>
        </div>
        <span className={`status ${uiStatus(post.status)}`}>
          {t(`status.${uiStatus(post.status)}`, uiStatus(post.status))}
        </span>
      </div>
      <article className="article-preview">
        {post.imageUrl && <img src={post.imageUrl} alt={post.imageAlt || ""} />}
        <p className="article-meta">
          {post.authorName || t("common.unknownAuthor")} ·{" "}
          {readableDate(post.datePublished, language)}
        </p>
        <h1>{post.title}</h1>
        <p className="article-lead">{post.excerptEs}</p>
        <div
          className="article-body"
          dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
        />
      </article>
      {hasSocialPack(post) && (
        <section className="card preview-social-link">
          <div>
            <p className="eyebrow">{t("social.eyebrow")}</p>
            <h2>{t("preview.socialPack")}</h2>
            <p className="muted">{t("social.description")}</p>
          </div>
          <button
            className="secondary"
            onClick={() => nav(`/social-pack/${encodeURIComponent(post.slug)}`)}
          >
            {t("preview.socialPack")}
          </button>
        </section>
      )}
      <div className="sticky-actions">
        <button
          className="ghost"
          onClick={() => nav(`/manual/${encodeURIComponent(post.slug)}`)}
        >
          {t("preview.edit")}
        </button>
        {hasSocialPack(post) && (
          <button
            className="secondary"
            onClick={() => nav(`/social-pack/${encodeURIComponent(post.slug)}`)}
          >
            {t("preview.socialPack")}
          </button>
        )}
        {post.status !== "published" && post.status !== "scheduled" && post.status !== "pending_schedule" && (
          <button
            className="secondary"
            onClick={() => nav(`/schedule/${encodeURIComponent(post.slug)}`)}
          >
            {t("preview.schedule")}
          </button>
        )}
        {(post.status !== "published" && post.status !== "scheduled" && post.status !== "pending_schedule") && (
          <button
            className="primary"
            onClick={() => nav(`/publish/${encodeURIComponent(post.slug)}`)}
          >
            {t("preview.publish")}
          </button>
        )}
      </div>
    </main>
  );
}

function CalendarDatePicker({
  value,
  min,
  onChange,
}: {
  value: string;
  min: string;
  onChange: (value: string) => void;
}) {
  const { t, language } = useI18n();
  const initial = value ? new Date(`${value}T12:00:00`) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  useEffect(() => {
    if (!value) return;
    const selected = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(selected.getTime())) {
      setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
  }, [value]);
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leading = (firstDay.getDay() + 6) % 7;
  const minDate = min ? new Date(`${min}T12:00:00`) : new Date();
  const dayNames = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(language === "en" ? "en-GB" : "es-ES", { weekday: "short" }).format(
      new Date(2024, 0, 1 + index),
    ),
  );
  const iso = (day: number) => {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const monthLabel = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "es-ES", { month: "long", year: "numeric" }).format(month);
  const goMonth = (delta: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  return (
    <div className="calendar-picker" aria-label={t("schedule.datePickerLabel")}>
      <div className="calendar-picker-head">
        <button type="button" className="icon-button" onClick={() => goMonth(-1)} aria-label={t("schedule.previousMonth")}>‹</button>
        <strong>{monthLabel}</strong>
        <button type="button" className="icon-button" onClick={() => goMonth(1)} aria-label={t("schedule.nextMonth")}>›</button>
      </div>
      <div className="calendar-weekdays">
        {dayNames.map((name) => <span key={name}>{name.slice(0, 2)}</span>)}
      </div>
      <div className="calendar-days">
        {Array.from({ length: leading }, (_, index) => <span key={`empty-${index}`} />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const dateIso = iso(day);
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const disabled = date < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
          return (
            <button
              key={dateIso}
              type="button"
              className={value === dateIso ? "selected" : ""}
              disabled={disabled}
              onClick={() => onChange(dateIso)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Schedule() {
  const { slug = "" } = useParams();
  const nav = useNavigate();
  const { site } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [seo, setSeo] = useState<{ ok?: boolean; errors?: string[] }>({});
  const initial = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [date, setDate] = useState(initial.toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api
      .post(slug, site)
      .then(({ post: loaded }) => setPost(loaded))
      .catch(() => {});
  }, [slug, site]);
  useEffect(() => {
    if (!post) return;
    api
      .validateSeo({ site, slug })
      .then((result) =>
        setSeo({
          ok: Boolean(result.ok),
          errors: (result.errors as string[]) || [],
        }),
      )
      .catch(() => setSeo({}));
  }, [post, site, slug]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!date || !time) return;
    setSaving(true);
    try {
      const publishAt = new Date(`${date}T${time}`).toISOString();
      const result = await api.schedule(slug, publishAt, site, { ignoreSeo: true, direct: true });
      showToast(result.message || t("schedule.scheduled"));
      nav("/posts");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
      showToast(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="page narrow">
      <PageTitle
        eyebrow={t("schedule.eyebrow")}
        title={t("schedule.title")}
        description={t("schedule.description")}
        back
      />
      <form className="card form-stack" onSubmit={submit}>
        <div className="date-picker-card">
          <div className="date-picker-heading">
            <div>
              <p className="eyebrow">{t("schedule.date")}</p>
              <strong>
                {date
                  ? readableDate(`${date}T${time}`, "es")
                  : t("schedule.chooseDate")}
              </strong>
            </div>
            <span>◷</span>
          </div>
          <div className="date-picker-fields">
            <CalendarDatePicker
              value={date}
              onChange={setDate}
              min={new Date().toISOString().slice(0, 10)}
            />
            <label>
              {t("schedule.time")}
              <input
                required
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          </div>
          <div className="date-quick-actions">
            <button
              type="button"
              className="chip"
              onClick={() =>
                setDate(
                  new Date(Date.now() + 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 10),
                )
              }
            >
              {t("schedule.tomorrow")}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() =>
                setDate(
                  new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 10),
                )
              }
            >
              {t("schedule.threeDays")}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() =>
                setDate(
                  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 10),
                )
              }
            >
              {t("schedule.nextWeek")}
            </button>
          </div>
        </div>
        {seo.ok === false && (
          <div className="seo-notice" role="status">
            <span>ⓘ</span>
            <p>{t("publish.seoNotice")}</p>
            <button type="button" className="text-link" onClick={() => nav(`/manual/${encodeURIComponent(slug)}`)}>
              {t("publish.fixSeo")}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button
          className="primary"
          disabled={saving}
        >
          {saving ? t("schedule.scheduling") : t("schedule.confirm")}
        </button>
        <button type="button" className="ghost" onClick={() => nav(-1)}>
          {t("common.back")}
        </button>
      </form>
    </main>
  );
}

function languageDateLabel(t: (key: string, fallback?: string) => string) {
  return t("schedule.date", "Fecha y hora");
}

function PublishSocial() {
  const { slug = "" } = useParams();
  const nav = useNavigate();
  const { site } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [socialPack, setSocialPack] = useState<Record<string, any> | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [articleUrl, setArticleUrl] = useState("");
  useEffect(() => {
    Promise.all([api.post(slug, site), api.onboarding(site).catch(() => ({}))])
      .then(([r, onboarding]) => {
        setPost(r.post);
        setSocialPack(r.post.socialPack || null);
        const domain = String(
          (onboarding as any)?.site?.domain || window.location.origin,
        ).replace(/\/$/, "");
        setArticleUrl(`${domain}/blog/${r.post.slug}`);
      })
      .catch((e) => setMessage(e.message));
  }, [slug, site]);
  const generatePack = async () => {
    if (!post) return;
    setBusy(true);
    try {
      const result = await api.aiGenerate({
        site,
        operation: "social-pack",
        prompt: `Genera un social pack para ${post.title}. Incluye este enlace canónico en los textos que admitan enlaces: ${articleUrl}`,
        post: { ...post, articleUrl },
        asyncImages: true,
      });
      const completePack = result.socialPack || {};
      setPost(result.post || { ...post, socialPack: completePack });
      setSocialPack(completePack);
      let warnings = result.socialPackWarnings || [];
      if (result.socialPackJobId) {
        setMessage(t("social.generatingImages", "Generando imágenes del carrusel…"));
        const job = await waitForSocialPackJob(result.socialPackJobId, site);
        setPost(job.post || result.post || { ...post, socialPack: job.socialPack || completePack });
        setSocialPack(job.socialPack || completePack);
        warnings = job.warnings || [];
      }
      setMessage(warnings.length ? warnings.join(" ") : result.content || t("publish.ready"));
      if (warnings.length) showToast(warnings.join(" "), "error");
      else showToast(t("publish.ready"));
    } catch (e) {
      const message = e instanceof Error ? e.message : t("common.error");
      setMessage(message);
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    try {
      const result = await api.publish(slug, site, undefined, { ignoreSeo: true, direct: true });
      setMessage(
        result.message ||
          t("publish.published"),
      );
      window.dispatchEvent(new CustomEvent("escarlet:conversation-archived", { detail: { site } }));
      showToast(result.message || t("publish.published"));
      setTimeout(() => nav("/posts"), 900);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("common.error"));
      showToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  };
  const hasPack = Boolean(socialPack && Object.keys(socialPack).length > 0);
  return (
    <main className="page narrow">
      <PageTitle
        eyebrow={t("publish.eyebrow")}
        title={t("publish.title")}
        description={t("publish.description")}
        back
      />
      {post && (
        <section className="card social-card">
          <h2>{post.title}</h2>
          <p className="muted">{t("publish.prepare")}</p>
          <AiOnly><button className="secondary" disabled={busy} onClick={generatePack}>
            {busy
              ? t("publish.preparing")
              : hasPack
                ? t("social.regenerate")
                : t("publish.generate")}
          </button></AiOnly>
          {hasPack && socialPack && (
            <div className="social-output">
              {Object.entries(socialPack).filter(([, text]) => typeof text === "string").map(([channel, text]) => (
                <article key={channel}>
                  <b>{channel}</b>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          )}
          <div className="channel-chips">
            <span>LinkedIn</span>
            <span>Instagram</span>
            <span>X</span>
            <span>Substack</span>
          </div>
          {hasPack && (
            <button
              className="secondary"
              onClick={() =>
                nav(`/social-pack/${encodeURIComponent(post.slug)}`)
              }
            >
              {t("preview.socialPack")}
            </button>
          )}
        </section>
      )}
      {message && <p className="success">{message}</p>}
      <div className="form-actions">
        <button className="ghost" onClick={() => nav(-1)}>
          {t("common.back")}
        </button>
        <button
          className="primary"
          disabled={busy || !post}
          onClick={publish}
        >
          {busy ? t("publish.publishing") : t("publish.now")}
        </button>
      </div>
    </main>
  );
}

function SocialPack() {
  const { slug = "" } = useParams();
  const { site } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const standalone = !slug;
  const [post, setPost] = useState<Post | null>(null);
  const [socialPack, setSocialPack] = useState<Record<string, any>>({});
  const [articleUrl, setArticleUrl] = useState("");
  const [standaloneTitle, setStandaloneTitle] = useState("");
  const [standaloneBrief, setStandaloneBrief] = useState("");
  const [standaloneUrl, setStandaloneUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  useEffect(() => {
    if (standalone) {
      setPost(null);
      setSocialPack({});
      setArticleUrl("");
      return;
    }
    let active = true;
    Promise.all([api.post(slug, site), api.onboarding(site).catch(() => ({}))])
      .then(([postData, onboarding]) => {
        if (!active) return;
        setPost(postData.post);
        setSocialPack(postData.post.socialPack || {});
        const domain = String(
          (onboarding as any)?.site?.domain || window.location.origin,
        ).replace(/\/$/, "");
        setArticleUrl(`${domain}/blog/${postData.post.slug}`);
      })
      .catch(
        (e) =>
          active &&
          setMessage(e instanceof Error ? e.message : t("common.error")),
      );
    return () => {
      active = false;
    };
  }, [slug, site, t, standalone]);
  const generatePack = async () => {
    if (standalone && !standaloneBrief.trim()) {
      const reason = t("social.standaloneRequired");
      setMessage(reason);
      showToast(reason, "error");
      return;
    }
    if (!standalone && !post) return;
    setBusy(true);
    setMessage("");
    try {
      const generatedTitle = (standaloneTitle.trim() || standaloneBrief.trim().split(/\r?\n/)[0] || t("social.standaloneDefaultTitle"))
        .slice(0, 120);
      const standaloneSlug = `social-pack-${Date.now().toString(36)}`;
      const generationPost = standalone
        ? ({
            slug: standaloneSlug,
            site,
            title: generatedTitle,
            status: "draft",
            bodyHtml: standaloneBrief.trim(),
            excerptEs: standaloneBrief.trim(),
            articleUrl: standaloneUrl.trim(),
          } as Post & { articleUrl?: string })
        : ({ ...post, articleUrl } as Post & { articleUrl?: string });
      const generationPrompt = standalone
        ? `Genera un Social Pack independiente para este tema. No existe ningún artículo de blog. Usa el contexto y crea contenido autónomo para Substack, LinkedIn, X, Instagram y vídeo. Tema/título: ${generatedTitle}. Contexto: ${standaloneBrief.trim()}${standaloneUrl.trim() ? ` Incluye este enlace de destino cuando encaje: ${standaloneUrl.trim()}` : ""}`
        : `Genera un social pack para ${post?.title}. Incluye este enlace canónico en los textos que admitan enlaces: ${articleUrl}`;
      const result = await api.aiGenerate({
        site,
        operation: "social-pack",
        prompt: generationPrompt,
        post: generationPost,
        asyncImages: true,
      });
      const completePack = result.socialPack || {};
      const nextPost = result.post || {
        ...generationPost,
        slug: standalone ? standaloneSlug : generationPost.slug,
        socialPack: completePack,
      };
      if (standalone) setArticleUrl(standaloneUrl.trim());
      setPost(nextPost as Post);
      setSocialPack(completePack);
      setActiveSlide(0);
      let warnings = result.socialPackWarnings || [];
      if (result.socialPackJobId) {
        setMessage(t("social.generatingImages", "Generando imágenes del carrusel…"));
        const job = await waitForSocialPackJob(result.socialPackJobId, site);
        setPost(job.post || result.post || { ...generationPost, slug: standalone ? standaloneSlug : generationPost.slug, socialPack: job.socialPack || completePack } as Post);
        setSocialPack(job.socialPack || completePack);
        warnings = job.warnings || [];
      }
      setMessage(warnings.length ? warnings.join(" ") : t("publish.ready"));
      if (warnings.length) showToast(warnings.join(" "), "error");
      else showToast(t("publish.ready"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("common.error"));
      showToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(t("social.copied"));
      showToast(t("social.copied"));
    } catch {
      setMessage(t("social.copyFailed"));
      showToast(t("social.copyFailed"), "error");
    }
  };
  const download = () => {
    const text = [
      `${post?.title || "Social Pack"}`,
      articleUrl,
      ...Object.entries(socialPack)
        .filter(([, value]) => typeof value === "string" && value)
        .map(([key, value]) => `\n## ${key}\n${value}`),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${post?.slug || "social-pack"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const downloadSlide = async (slide: any, index: number) => {
    const image = slide?.imageUrl || slide?.url || slide?.image || "";
    if (!image) return;
    const filename = `${post?.slug || "social-pack"}-instagram-${String(index + 1).padStart(2, "0")}.png`;
    try {
      const response = await fetch(image);
      if (!response.ok) throw new Error("No se pudo descargar la slide.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      const link = document.createElement("a");
      link.href = image;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    showToast(t("social.slideDownloaded"));
  };
  const fields = [
    { key: "substackTitle", label: t("social.substackTitle") },
    { key: "substackBody", label: t("social.substackBody") },
    { key: "linkedin", label: t("social.linkedin") },
    { key: "x", label: t("social.x") },
    { key: "instagramCaption", label: t("social.instagram") },
  ];
  const teleprompterScript =
    typeof socialPack.videoScript === "string" && socialPack.videoScript
      ? socialPack.videoScript
      : [post?.title, post?.excerptEs].filter(Boolean).join("\n\n");
  const blogImage = post?.imageThumbUrl || post?.imageUrl || "";
  let blogImageSrc = blogImage;
  if (blogImage.startsWith("/images/") && articleUrl) {
    try {
      blogImageSrc = `${new URL(articleUrl, window.location.origin).origin}${blogImage}`;
    } catch {
      blogImageSrc = blogImage;
    }
  }
  const carouselSlides = Array.isArray(socialPack.instagramSlides)
    ? socialPack.instagramSlides
    : [];
  const safeSlideIndex = carouselSlides.length
    ? Math.min(activeSlide, carouselSlides.length - 1)
    : 0;
  const activeCarouselSlide = carouselSlides[safeSlideIndex];
  const activeCarouselImage = activeCarouselSlide?.imageUrl || activeCarouselSlide?.url || activeCarouselSlide?.image || "";
  return (
    <main className="page social-pack-page">
      <PageTitle
        eyebrow={t("social.eyebrow")}
        title={t("social.title")}
        description={t("social.description")}
        back
      />
      {standalone && !post && (
        <section className="card form-stack social-standalone-composer">
          <p className="eyebrow">{t("social.standaloneEyebrow")}</p>
          <h2>{t("social.standaloneTitle")}</h2>
          <p className="muted">{t("social.standaloneHelp")}</p>
          <label>
            {t("social.standaloneTopic")}
            <input
              value={standaloneTitle}
              onChange={(event) => setStandaloneTitle(event.target.value)}
              placeholder={t("social.standaloneTopicPlaceholder")}
              maxLength={120}
            />
          </label>
          <label>
            {t("social.standaloneBrief")}
            <textarea
              value={standaloneBrief}
              onChange={(event) => setStandaloneBrief(event.target.value)}
              placeholder={t("social.standaloneBriefPlaceholder")}
              rows={7}
              autoFocus
            />
          </label>
          <label>
            {t("social.standaloneUrl")}
            <input
              type="url"
              value={standaloneUrl}
              onChange={(event) => setStandaloneUrl(event.target.value)}
              placeholder="https://ejemplo.com/landing"
            />
          </label>
          <div className="form-actions">
            <AiOnly><button className="primary" onClick={() => void generatePack()} disabled={busy || !standaloneBrief.trim()}>
              {busy ? t("publish.preparing") : t("social.generate")}
            </button></AiOnly>
          </div>
        </section>
      )}
      {post && (
        <div className="social-pack-toolbar">
          {articleUrl ? <div>
            <p className="eyebrow">{standalone ? t("social.standaloneUrl") : t("social.articleUrl")}</p>
            <a
              className="article-url"
              href={articleUrl}
              target="_blank"
              rel="noreferrer"
            >
              {articleUrl}
            </a>
          </div> : <div>
            <p className="eyebrow">{t("social.standaloneEyebrow")}</p>
            <strong>{post.title}</strong>
          </div>}
          <div className="form-actions">
            {articleUrl && <button className="ghost" onClick={() => void copy(articleUrl)}>
              {t("social.copyUrl")}
            </button>}
            {standalone && <button className="ghost" onClick={() => { setPost(null); setSocialPack({}); setArticleUrl(""); setStandaloneTitle(""); setStandaloneBrief(""); setStandaloneUrl(""); setMessage(""); }}>
              {t("social.standaloneNew")}
            </button>}
            <button
              className="secondary"
              onClick={download}
              disabled={!Object.keys(socialPack).length}
            >
              {t("social.download")}
            </button>
          </div>
        </div>
      )}
      {post && socialPack && Object.keys(socialPack).length > 0 && (
        <div className="social-pack-generation-actions">
          <AiOnly><button
            className="primary"
            onClick={() => void generatePack()}
            disabled={busy}
          >
            {busy
              ? t("publish.preparing")
              : t("social.regenerate")}
          </button></AiOnly>
        </div>
      )}
      {post && (
        <section className="social-visual-grid">
          {blogImageSrc && (
            <article className="card social-cover-card">
              <p className="eyebrow">{t("social.blogImage")}</p>
              <img
                src={blogImageSrc}
                alt={post.imageAlt || post.title}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                  event.currentTarget.parentElement?.classList.add(
                    "image-missing",
                  );
                }}
              />
              <p className="muted">{post.title}</p>
            </article>
          )}
          <article className="card social-carousel-card">
                <div className="social-channel-head">
                  <div>
                    <p className="eyebrow">{t("social.instagramCarousel")}</p>
                    <h2>{t("social.carouselTitle")}</h2>
                  </div>
                  <button
                    className="chip"
                    onClick={() =>
                      void copy(JSON.stringify(socialPack.instagramSlides))
                    }
                  >
                    {t("social.copy")}
                  </button>
                </div>
                {carouselSlides.length > 0 ? (
                  <div className="instagram-carousel" role="region" aria-label={t("social.carouselTitle")}>
                    <div className="instagram-carousel-stage">
                      <button
                        className="carousel-nav carousel-prev"
                        type="button"
                        onClick={() => setActiveSlide((safeSlideIndex - 1 + carouselSlides.length) % carouselSlides.length)}
                        aria-label={t("social.previousSlide")}
                        title={t("social.previousSlide")}
                      >
                        ‹
                      </button>
                      <figure>
                        {activeCarouselImage ? (
                          <img
                            src={activeCarouselImage}
                            alt={
                              activeCarouselSlide?.alt ||
                              activeCarouselSlide?.headline ||
                              `${t("social.slide")} ${safeSlideIndex + 1}`
                            }
                          />
                        ) : (
                          <div className="carousel-placeholder">{safeSlideIndex + 1}</div>
                        )}
                        <figcaption>
                          <span>
                            {activeCarouselSlide?.headline || activeCarouselSlide?.text || `${t("social.slide")} ${safeSlideIndex + 1}`}
                          </span>
                          {activeCarouselImage && (
                            <button
                              className="chip"
                              type="button"
                              onClick={() => void downloadSlide(activeCarouselSlide, safeSlideIndex)}
                            >
                              {t("social.downloadSlide")}
                            </button>
                          )}
                        </figcaption>
                      </figure>
                      <button
                        className="carousel-nav carousel-next"
                        type="button"
                        onClick={() => setActiveSlide((safeSlideIndex + 1) % carouselSlides.length)}
                        aria-label={t("social.nextSlide")}
                        title={t("social.nextSlide")}
                      >
                        ›
                      </button>
                    </div>
                    <div className="carousel-dots" role="tablist" aria-label={t("social.carouselTitle")}>
                      {carouselSlides.map((slide: any, index: number) => (
                        <button
                          key={slide?.id || `${slide?.imageUrl || "slide"}-${index}`}
                          className={`carousel-dot${index === safeSlideIndex ? " active" : ""}`}
                          type="button"
                          role="tab"
                          aria-selected={index === safeSlideIndex}
                          aria-label={`${t("social.slide")} ${index + 1}`}
                          onClick={() => setActiveSlide(index)}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted carousel-empty">
                    {t("social.carouselEmpty")}
                  </p>
                )}
          </article>
        </section>
      )}
      {post && teleprompterScript && (
        <section className="card teleprompter-launch-card">
          <div>
            <p className="eyebrow">{t("social.video")}</p>
            <h2>{t("social.recordTitle")}</h2>
            <p className="muted">{t("social.recordHelp")}</p>
          </div>
          <button
            className="primary"
            onClick={() => setShowTeleprompter(true)}
          >
            {t("social.record")}
          </button>
        </section>
      )}
      {post && Object.keys(socialPack).length ? (
        <div className="social-pack-grid">
          {fields.map(
            (field) =>
              typeof socialPack[field.key] === "string" &&
              socialPack[field.key] && (
                <article className="card social-channel-card" key={field.key}>
                  <div className="social-channel-head">
                    <h2>{field.label}</h2>
                    <button
                      className="chip"
                      onClick={() => void copy(socialPack[field.key])}
                    >
                      {t("social.copy")}
                    </button>
                  </div>
                  <p>{socialPack[field.key]}</p>
                </article>
              ),
          )}
          {typeof socialPack.videoScript === "string" &&
            socialPack.videoScript && (
              <article className="card social-channel-card video-script-card">
                <div className="social-channel-head">
                  <h2>{t("social.video")}</h2>
                </div>
                <p>{socialPack.videoScript}</p>
              </article>
            )}
        </div>
      ) : post ? (
        <section className="empty-state">
          <span>✦</span>
          <h2>{t("social.empty")}</h2>
          <p>{t("social.description")}</p>
          <AiOnly><button
            className="primary"
            onClick={() => void generatePack()}
            disabled={busy}
          >
            {busy ? t("publish.preparing") : t("social.generate")}
          </button></AiOnly>
        </section>
      ) : null}
      {message && <p className="success">{message}</p>}
      {showTeleprompter && (
        <TeleprompterModal
          script={teleprompterScript}
          onClose={() => setShowTeleprompter(false)}
        />
      )}
    </main>
  );
}

function TeleprompterModal({
  script,
  onClose,
}: {
  script: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const paragraphs = useMemo(
    () => script.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean),
    [script],
  );
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [currentParagraph, setCurrentParagraph] = useState(0);
  const speed = 1;
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setCurrentParagraph(0);
    setPlaying(false);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    return () => {
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => scrollRef.current?.scrollBy({ top: speed, behavior: "auto" }),
      45,
    );
    return () => window.clearInterval(timer);
  }, [playing, speed]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl],
  );
  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(t("social.cameraError"));
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const url = URL.createObjectURL(
          new Blob(chunksRef.current, { type: "video/webm" }),
        );
        setVideoUrl(url);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setPlaying(false);
      setCountdown(3);
      let remaining = 3;
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
          setCountdown(0);
          setPlaying(true);
        } else {
          setCountdown(remaining);
        }
      }, 1000);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("social.cameraError"));
    }
  };
  const stop = () => {
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setCountdown(0);
    setPlaying(false);
  };
  const nextParagraph = () => {
    const next = Math.min(currentParagraph + 1, Math.max(paragraphs.length - 1, 0));
    setCurrentParagraph(next);
    paragraphRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPlaying(true);
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-card teleprompter-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">{t("social.video")}</p>
            <h2>{t("social.record")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("editor.close")}
          >
            ×
          </button>
        </div>
        <div className="teleprompter-layout">
          <div className="camera-stage">
            <video ref={videoRef} muted playsInline />
            <span>{recording ? "●" : "○"}</span>
            {countdown > 0 && (
              <div className="teleprompter-countdown" aria-live="assertive">
                <strong>{countdown}</strong>
                <small>{t("social.getReady")}</small>
              </div>
            )}
          </div>
          <div className="teleprompter-script" ref={scrollRef}>
            {paragraphs.map((paragraph, index) => (
              <p
                key={`${index}-${paragraph.slice(0, 18)}`}
                ref={(element) => { paragraphRefs.current[index] = element; }}
                className={index === currentParagraph ? "active" : ""}
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
        <div className="teleprompter-controls">
          <button
            className={recording ? "danger-button" : "primary"}
            onClick={recording ? stop : start}
          >
            {recording ? t("social.stop") : t("social.record")}
          </button>
          <button
            className="secondary"
            onClick={() => setPlaying((value) => !value)}
            disabled={countdown > 0}
          >
            {playing ? t("social.pause") : t("social.play")}
          </button>
          <button
            className="teleprompter-next"
            type="button"
            onClick={nextParagraph}
            disabled={!paragraphs.length || currentParagraph >= paragraphs.length - 1}
          >
            {t("social.nextParagraph")}
          </button>
          {videoUrl && (
            <a
              className="secondary"
              href={videoUrl}
              download="escarlet-video.webm"
            >
              {t("social.downloadVideo")}
            </a>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}

function Posts() {
  const { site } = useApp();
  const { t } = useI18n();
  const location = useLocation();
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scheduledView, setScheduledView] = useState<"list" | "month">("list");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedFilter = params.get("status");
    if (requestedFilter && ["all", "draft", "scheduled", "published"].includes(requestedFilter)) {
      setStatusFilter(requestedFilter);
    }
    if (params.get("view") === "month") setScheduledView("month");
  }, [location.search]);
  const nav = useNavigate();
  useEffect(() => {
    api
      .posts(site)
      .then((r) => setPosts(r.posts))
      .catch((e) => setError(e.message));
  }, [site]);
  const visiblePosts = useMemo(
    () =>
      posts
        .filter((post) => {
          const matchesStatus =
            statusFilter === "all" || uiStatus(post.status) === statusFilter;
          const needle = query.trim().toLowerCase();
          return (
            matchesStatus &&
            (!needle ||
              `${post.title} ${post.slug}`.toLowerCase().includes(needle))
          );
        })
        .sort(
          (a, b) =>
            new Date(
              b.dateModified || b.publishAt || b.datePublished || 0,
            ).getTime() -
            new Date(
              a.dateModified || a.publishAt || a.datePublished || 0,
            ).getTime(),
        ),
    [posts, query, statusFilter],
  );
  return (
    <main className="page">
      <div className="page-header">
        <PageTitle
          eyebrow={t("posts.eyebrow")}
          title={t("posts.title")}
          description={t("posts.description")}
        />
        <button className="primary" onClick={() => nav("/manual")}>
          {t("posts.new")}
        </button>
      </div>
      {error ? (
        <p className="error">{error}</p>
      ) : posts.length ? (
        <>
          <div className="post-filters">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("posts.search")}
              aria-label={t("posts.search")}
            />
            <div
              className="filter-pills"
              role="group"
              aria-label={t("posts.filter")}
            >
              {["all", "draft", "scheduled", "published"].map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`filter-pill ${statusFilter === filter ? "selected" : ""}`}
                    onClick={() => {
                      setStatusFilter(filter);
                      if (filter !== "scheduled") setScheduledView("list");
                    }}
                  >
                    {t(`posts.filter.${filter}`)}
                  </button>
                ),
              )}
            </div>
          </div>
          {statusFilter === "scheduled" && (
            <div className="posts-view-toolbar">
              <span>{t("calendar.onlyScheduled")}</span>
              <button
                type="button"
                className="icon-button calendar-view-toggle"
                onClick={() => setScheduledView((current) => current === "list" ? "month" : "list")}
                aria-label={t(scheduledView === "list" ? "calendar.monthView" : "calendar.listView")}
                title={t(scheduledView === "list" ? "calendar.monthView" : "calendar.listView")}
              >
                {scheduledView === "list" ? "▦" : "☷"}
              </button>
            </div>
          )}
          {statusFilter === "scheduled" && scheduledView === "month" ? (
            <Calendar embedded postsOverride={visiblePosts} />
          ) : visiblePosts.length ? (
            <div className="post-list">
                {visiblePosts.map((post) => (
                <PostRow key={post.slug || (post as any).id} post={post} onDeleted={(slug) => setPosts((current) => current.filter((item) => String(item.slug || (item as any).id || "") !== slug))} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("posts.noMatches")}
              action={t("posts.clearFilters")}
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            />
          )}
        </>
      ) : (
        <EmptyState
          title={t("posts.empty")}
          action={t("posts.emptyAction")}
          onClick={() => nav("/manual")}
        />
      )}
    </main>
  );
}
function PostRow({ post, onDeleted }: { post: Post; onDeleted?: (slug: string) => void }) {
  const nav = useNavigate();
  const { t, language } = useI18n();
  const { showToast } = useToast();
  const [imageError, setImageError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const statusKey = uiStatus(post.status);
  const status = t(`status.${statusKey}`, statusKey);
  const imageSrc = post.imageThumbUrl || post.imageUrl;
  const postSlug = String(post.slug || (post as any).id || "").trim();
  return (
    <div className="post-row">
      <button
        className="post-row-main"
        onClick={() => postSlug && nav(`/preview/${encodeURIComponent(postSlug)}`)}
      >
        {imageSrc && !imageError ? (
          <img
            className="post-thumb"
            src={imageSrc}
            alt=""
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <span className="post-thumb placeholder-thumb">✦</span>
        )}
        <div className="post-row-copy">
          <span className={`status ${statusKey}`}>{status}</span>
          <h3>{post.title}</h3>
          <p>
            {post.publishAt
              ? `${t("status.scheduled")}: ${readableDate(post.publishAt, language)}`
              : `${t("posts.title")}: ${readableDate(post.dateModified || post.datePublished, language)}`}
          </p>
        </div>
        <span className="chevron">›</span>
      </button>
      {hasSocialPack(post) && (
        <button
          className="post-pack-button"
          type="button"
          onClick={() => postSlug && nav(`/social-pack/${encodeURIComponent(postSlug)}`)}
          aria-label={t("preview.socialPack")}
          title={t("preview.socialPack")}
        >
          <MobileSocialIcon />
        </button>
      )}
      <button
        className="post-delete-button"
        type="button"
        disabled={deleting}
        onClick={async (event) => {
          event.stopPropagation();
          if (!window.confirm(t("posts.deleteConfirm"))) return;
          if (!postSlug) {
            showToast(t("posts.deleteUnavailable"), "error");
            return;
          }
          setDeleting(true);
          try {
            await api.deletePost(postSlug, post.site);
            onDeleted?.(postSlug);
            showToast(t("posts.deleted"));
          } catch (error) {
            showToast(error instanceof Error ? error.message : t("common.error"), "error");
          } finally {
            setDeleting(false);
          }
        }}
        aria-label={t("posts.delete")}
        title={t("posts.delete")}
      >
        {deleting ? "…" : "⌫"}
      </button>
    </div>
  );
}

function Calendar({ embedded = false, postsOverride }: { embedded?: boolean; postsOverride?: Post[] }) {
  const { site } = useApp();
  const { t, language } = useI18n();
  const nav = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<"list" | "month">(embedded ? "month" : "list");
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  useEffect(() => {
    if (postsOverride) {
      setPosts(postsOverride);
      setError("");
      return;
    }
    api
      .calendar(site)
      .then((r) => setPosts(r.posts || []))
      .catch((e) => setError(e.message));
  }, [site, retry, postsOverride]);
  const scheduledPosts = useMemo(
    () => posts
      .filter((post) => ["pending_schedule", "scheduled"].includes(post.status) && Boolean(post.publishAt))
      .sort((a, b) => new Date(b.publishAt || 0).getTime() - new Date(a.publishAt || 0).getTime()),
    [posts],
  );
  const grouped = useMemo(
    () =>
      scheduledPosts.reduce<Record<string, Post[]>>((acc, post) => {
        const key = (post.publishAt || "").slice(0, 10);
        (acc[key] ||= []).push(post);
        return acc;
      }, {}),
    [scheduledPosts],
  );
  const monthDays = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const dayNumber = index - firstWeekday + 1;
      const date = new Date(year, month, dayNumber);
      return { date, inMonth: dayNumber >= 1 && dayNumber <= daysInMonth };
    });
  }, [monthCursor]);
  const dayKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const monthLabel = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "es-ES", {
    month: "long",
    year: "numeric",
  }).format(monthCursor);
  const weekDays = language === "en"
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  return (
    <main className={`page ${embedded ? "calendar-embedded" : ""}`}>
      {!embedded && <PageTitle
          eyebrow={t("calendar.eyebrow")}
          title={t("calendar.title")}
          description={t("calendar.description")}
          back
        />}
      {error && (
        <section className="calendar-error card">
          <span className="calendar-error-icon">□</span>
          <div>
            <h2>{t("calendar.errorTitle")}</h2>
            <p className="muted">{t("calendar.errorHelp")}</p>
            <button
              className="secondary"
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              {t("calendar.retry")}
            </button>
          </div>
        </section>
      )}
      {!embedded && <div className="calendar-toolbar">
          <p className="tiny">{t("calendar.onlyScheduled")}</p>
          <button
            type="button"
            className="icon-button calendar-view-toggle"
            onClick={() => setView((current) => current === "list" ? "month" : "list")}
            aria-label={t(view === "list" ? "calendar.monthView" : "calendar.listView")}
            title={t(view === "list" ? "calendar.monthView" : "calendar.listView")}
          >
            {view === "list" ? "▦" : "☷"}
          </button>
        </div>}
      {scheduledPosts.length ? (view === "list" ? (
        <div className="calendar-list">
          {Object.entries(grouped).map(([date, rows]) => (
            <section key={date}>
              <h2>{readableDate(date, language)}</h2>
              {rows.map((post) => <PostRow key={post.slug || (post as any).id} post={post} />)}
            </section>
          ))}
        </div>
      ) : (
        <section className="calendar-month card">
          <div className="calendar-month-head">
            <button type="button" className="icon-button" onClick={() => setMonthCursor((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))} aria-label={t("calendar.previousMonth")}>‹</button>
            <strong>{monthLabel}</strong>
            <button type="button" className="icon-button" onClick={() => setMonthCursor((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))} aria-label={t("calendar.nextMonth")}>›</button>
          </div>
          <div className="calendar-weekdays">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-month-grid">
            {monthDays.map(({ date, inMonth }) => {
              const rows = scheduledPosts.filter((post) => dayKey(new Date(post.publishAt || "")) === dayKey(date));
              return (
                <div key={dayKey(date)} className={`calendar-day ${inMonth ? "" : "outside"} ${rows.length ? "has-posts" : ""}`}>
                  <span>{date.getDate()}</span>
                  {rows.slice(0, 2).map((post) => (
                    <button key={post.slug || (post as any).id} type="button" className="calendar-day-post" onClick={() => post.slug && nav(`/preview/${encodeURIComponent(post.slug)}`)} title={post.title}>{post.title}</button>
                  ))}
                  {rows.length > 2 && <small>+{rows.length - 2}</small>}
                </div>
              );
            })}
          </div>
        </section>
      )) : null}
      {!scheduledPosts.length && !error && (
          <EmptyState
            title={t("calendar.empty")}
            action={t("posts.emptyAction")}
            onClick={() => window.location.assign("./manual")}
          />
      )}
    </main>
  );
}

function AuthorInvite() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const nav = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      setStatus("error");
      setMessage(t("authorInvite.missing"));
      return;
    }
    api.acceptAuthorInvite(token).then(() => {
      setStatus("success");
      setMessage(t("authorInvite.success"));
      showToast(t("authorInvite.success"));
    }).catch((error) => {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t("common.error"));
    });
  }, [showToast, t]);
  return (
    <main className="page narrow">
      <PageTitle eyebrow={t("authorInvite.eyebrow")} title={t("authorInvite.title")} description={t("authorInvite.description")} back />
      <section className={`card invite-result ${status}`}>
        <span className="invite-result-icon">{status === "loading" ? "…" : status === "success" ? "✓" : "!"}</span>
        <p>{status === "loading" ? t("common.loading") : message}</p>
        <button className="primary" type="button" onClick={() => nav("/settings")}>{t("authorInvite.continue")}</button>
      </section>
    </main>
  );
}

function Settings() {
  const { session, site, refresh, workflowFlags } = useApp();
  const { language, setLanguage, t } = useI18n();
  const { showToast } = useToast();
  const [model, setModel] = useState(
    localStorage.getItem("escarlet_model") || "auto",
  );
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([
    { value: "auto", label: t("settings.modelAuto") },
  ]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [displayName, setDisplayName] = useState(session.displayName || "");
  const [bio, setBio] = useState(session.bio || "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(session.avatarUrl || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [delegates, setDelegates] = useState<Array<Record<string, any>>>([]);
  const [delegateBusy, setDelegateBusy] = useState("");
  useEffect(() => {
    if (!workflowFlags.cmsAiEnabled) {
      setModelOptions([{ value: "auto", label: t("settings.modelAuto") }]);
      return;
    }
    api.billingSnapshot(site).then((snapshot) => {
      const options = (snapshot.models || [])
        .map((item: any) => ({ value: String(item.id || ""), label: String(item.name || item.id || "") }))
        .filter((item: { value: string; label: string }) => item.value && item.label);
      setModelOptions([{ value: "auto", label: t("settings.modelAuto") }, ...options]);
      if (model !== "auto" && !options.some((item: { value: string }) => item.value === model)) setModel("auto");
    }).catch(() => setModelOptions([{ value: "auto", label: t("settings.modelAuto") }]));
  }, [site, t, workflowFlags.cmsAiEnabled]);
  useEffect(() => {
    if (!session.userId) return;
    api.publishingDelegates(site)
      .then((result) => setDelegates(result.users || []))
      .catch(() => setDelegates([]));
  }, [session.userId, site]);
  const save = () => {
    localStorage.setItem("escarlet_model", model);
    setError("");
    setMessage(t("settings.saved"));
    showToast(t("settings.saved"));
  };
  const logout = async () => {
    setLoggingOut(true);
    setMessage("");
    setError("");
    try {
      await api.logout();
      showToast(t("settings.loggedOut"));
      await refresh();
    } catch (err) {
      setLoggingOut(false);
      setError(err instanceof Error ? err.message : t("common.error"));
      showToast(err instanceof Error ? err.message : t("common.error"), "error");
    }
  };
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileSaving(true);
    try {
      await api.saveProfile({ displayName, bio, avatarDataUrl, allowPublishingAs: false });
      await refresh();
      showToast(t("settings.profileSaved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setProfileSaving(false);
    }
  };
  const chooseProfileAvatar = async (file?: File) => {
    if (!file) return;
    try {
      setAvatarDataUrl(await fileAsBase64(file));
    } catch {
      showToast(t("editor.readImageError"), "error");
    }
  };
  const toggleDelegate = async (delegate: Record<string, any>) => {
    if (!delegate.id) return;
    const enabled = !Boolean(delegate.enabled);
    setDelegateBusy(delegate.id);
    try {
      await api.setPublishingDelegate({ site, delegateId: delegate.id, enabled });
      setDelegates((current) => current.map((item) => item.id === delegate.id ? { ...item, enabled } : item));
      showToast(t(enabled ? "settings.delegateGranted" : "settings.delegateRevoked"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setDelegateBusy("");
    }
  };
  return (
    <main className="page narrow">
      <PageTitle
        eyebrow={t("settings.eyebrow")}
        title={t("settings.title")}
        description={t("settings.description")}
        back
      />
      {session.userId && (
        <form className="card settings-card profile-settings-card" onSubmit={saveProfile}>
          <p className="eyebrow">{t("settings.profileEyebrow")}</p>
          <h2>{t("settings.profileTitle")}</h2>
          <p className="muted">{t("settings.profileHelp")}</p>
          <ProfileAvatarField
            src={avatarDataUrl}
            name={displayName || session.email}
            label={t("settings.avatar")}
            help={t("settings.avatarHelp")}
            chooseLabel={t("settings.avatarChoose")}
            removeLabel={t("settings.avatarRemove")}
            onChange={chooseProfileAvatar}
            onRemove={() => setAvatarDataUrl("")}
          />
          <label>{t("settings.displayName")}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("settings.displayNamePlaceholder")} /></label>
          <label>{t("settings.bio")}<textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder={t("settings.bioPlaceholder")} rows={4} /></label>
          <button className="primary" disabled={profileSaving}>{profileSaving ? "…" : t("settings.profileSave")}</button>
        </form>
      )}
      {session.userId && (
        <section className="card settings-card delegation-card">
          <p className="eyebrow">{t("settings.delegatesEyebrow")}</p>
          <h2>{t("settings.delegatesTitle")}</h2>
          <p className="muted">{t("settings.delegatesHelp")}</p>
          {delegates.length ? (
            <div className="delegation-pills" role="group" aria-label={t("settings.delegatesTitle")}>
              {delegates.map((delegate) => (
                <button
                  key={delegate.id}
                  type="button"
                  className={`author-pill ${delegate.enabled ? "selected" : ""}`}
                  disabled={delegateBusy === delegate.id}
                  onClick={() => void toggleDelegate(delegate)}
                >
                  <UserAvatar src={delegate.avatarUrl} name={delegate.displayName || delegate.email} size="sm" />
                  <span>{delegate.displayName || delegate.email}</span>
                  <small>{delegate.enabled ? t("settings.delegateActive") : t("settings.delegateInactive")}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty">{t("settings.delegatesEmpty")}</p>
          )}
        </section>
      )}
      <section className="card settings-card">
        <label>
          {t("settings.language")}
          <ChoicePills
            value={language}
            ariaLabel={t("settings.language")}
            onChange={(value) => setLanguage(value as Language)}
            options={[
              { value: "es", label: t("settings.spanish") },
              { value: "en", label: t("settings.english") },
            ]}
          />
        </label>
        <AiOnly><label>
          {t("settings.model")}
          <ChoicePills
            value={model}
            ariaLabel={t("settings.model")}
            onChange={setModel}
            options={modelOptions}
          />
        </label>
        <p className="tiny">{t("settings.modelHelp")}</p>
        <button className="secondary" onClick={save}>
          {t("settings.save")}
        </button></AiOnly>
        {message && <p className="success">{message}</p>}
      </section>
      <section className="card settings-card">
        <p className="eyebrow">{t("settings.workspace")}</p>
        <h2>{site}</h2>
        <p className="muted">
          {t("settings.role")}: {roleLabel(session.role, t)}
        </p>
        <NavLink className="text-link" to="/billing">
          {t(session.role === "client_mcp" ? "mcp.membership" : "settings.credits")}
        </NavLink>
      </section>
      <button
        type="button"
        className="danger-button"
        onClick={() => void logout()}
        disabled={loggingOut}
      >
        {loggingOut ? t("settings.loggingOut") : t("settings.logout")}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function Billing() {
  const { site, session, workflowFlags } = useApp();
  const { t, language } = useI18n();
  const { showToast } = useToast();
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (session.role !== "client_mcp" && !workflowFlags.cmsAiEnabled) {
      setSnapshot(null);
      setMessage("");
      return;
    }
    api
      .billingSnapshot(site)
      .then(setSnapshot)
      .catch(() => setMessage(t("billing.unavailable")));
  }, [site, t, session.role, workflowFlags.cmsAiEnabled]);
  const checkout = async (input: {
    kind: "membership" | "credits";
    planId?: string;
    packId?: string;
  }) => {
    setBusy(input.planId || input.packId || input.kind);
    try {
      const result = await api.billingCheckout({ site, ...input });
      if (result.testMode && result.credited) {
        const credited = Number(result.tokenCredits || 0).toLocaleString(language === "en" ? "en-GB" : "es-ES");
        const next = await api.billingSnapshot(site);
        setSnapshot(next);
        setMessage(`${t("billing.testCreditsAdded")} ${credited}.`);
        showToast(`${t("billing.testCreditsAdded")} ${credited}.`);
      } else if (result.url) window.location.assign(result.url);
      else { setMessage(t("billing.paymentNotConfigured")); showToast(t("billing.paymentNotConfigured"), "info"); }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("billing.checkoutFailed"));
      showToast(e instanceof Error ? e.message : t("billing.checkoutFailed"), "error");
    } finally {
      setBusy("");
    }
  };
  const portal = async () => {
    setBusy("portal");
    try {
      const result = await api.billingPortal({ site });
      if (result.url) window.location.assign(result.url);
      else { setMessage(t("billing.portalUnavailable")); showToast(t("billing.portalUnavailable"), "info"); }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("billing.portalFailed"));
      showToast(e instanceof Error ? e.message : t("billing.portalFailed"), "error");
    } finally {
      setBusy("");
    }
  };
  const ai = snapshot?.ai?.tokenCredits;
  if (session.role === "client_mcp") return <main className="page narrow">
    <PageTitle title={t("mcp.membership")} description={t("mcp.help")} back />
    <section className="card settings-card">
      <h2>{snapshot?.plan?.name || "CMS con ChatGPT"}</h2>
      <p>{snapshot?.subscription?.source === "grant" && !snapshot?.suspended ? t("mcp.complimentaryActive") : snapshot?.subscription?.status === "trialing" && !snapshot?.suspended ? t("mcp.trialActive") : snapshot?.suspended ? t("mcp.readOnly") : t("mcp.active")}</p>
      <p>{snapshot ? `${Math.max(0, snapshot.publishes.limit - snapshot.publishes.used)} / ${snapshot.publishes.limit} ${t("mcp.publicationsLeft")}` : t("common.loading")}</p>
      {snapshot?.subscription?.trialEndsAt && <p className="tiny">{t("mcp.trialActive")} · {new Date(Number(snapshot.subscription.trialEndsAt) * 1000).toLocaleDateString(language === "en" ? "en-GB" : "es-ES")}</p>}
      <div className="membership-grant-scope"><strong>{t("mcp.membershipCoverage")}</strong><span>{site}</span><span>{t("mcp.billingHelp")}</span></div>
      <div className="form-actions">{!(snapshot?.subscription?.source === "grant" && !snapshot?.suspended) && <><button className="primary" disabled={Boolean(busy) || !snapshot?.stripe?.plans?.mcp} onClick={() => checkout({ kind: "membership", planId: "mcp" })}>{t("mcp.subscribe")}</button>
      <button className="secondary" disabled={Boolean(busy)} onClick={portal}>{t("billing.manage")}</button></>}</div>
    </section>
    <section className="card settings-card"><h2>{t("mcp.connector")}</h2><p>{t("mcp.help")}</p><code>{window.location.origin}/mcp</code></section>
    {message && <p role="status">{message}</p>}
  </main>;
  if (!workflowFlags.cmsAiEnabled) return <main className="page narrow">
    <PageTitle title={t("billing.title")} description={t("billing.cmsAiDisabled")} back />
    <section className="card settings-card">
      <h2>{t("billing.cmsAiDisabledTitle")}</h2>
      <p className="muted">{t("billing.cmsAiDisabledHelp")}</p>
      <NavLink className="text-link" to="/manual">{t("home.manual.action")}</NavLink>
    </section>
  </main>;
  const testCreditsEnabled = Boolean(snapshot?.stripe?.testCreditsEnabled);
  const packs = (snapshot?.creditPacks || []) as Array<{
    id: string;
    name: string;
    tokenCredits: number;
    configured?: boolean;
  }>;
  return (
    <main className="page narrow">
      <PageTitle
        eyebrow={t("billing.eyebrow")}
        title={t("billing.title")}
        description={t("billing.description")}
        back
      />
      <section className="card quota-card">
        <h2>{t("billing.ai")}</h2>
        {snapshot ? (
          <>
            <strong className="credit-number">
              {Number(ai?.available || 0).toLocaleString(
                language === "en" ? "en-GB" : "es-ES",
              )}
            </strong>
            <p className="muted">
              {t("billing.available")} ·{" "}
              {Number(ai?.monthlyRemaining || 0).toLocaleString(
                language === "en" ? "en-GB" : "es-ES",
              )}{" "}
              {t("billing.included")}
            </p>
            <p className="tiny">
              {t("billing.plan")}:{" "}
              {snapshot?.plan?.name || snapshot?.plan?.id || "—"}
            </p>
            {testCreditsEnabled && (
              <div className="temporary-flag-warning billing-test-banner" role="status">
                <strong>{t("billing.testModeTitle")}</strong>
                <span>{t("billing.testModeHelp")}</span>
              </div>
            )}
          </>
        ) : (
          <p className="muted">{t("common.loading")}</p>
        )}
        <button className="ghost" disabled={busy === "portal"} onClick={portal}>
          {busy === "portal" ? t("billing.opening") : t("billing.manage")}
        </button>
      </section>
      <section className="card credit-help-card">
        <p className="eyebrow">{t("billing.howItWorks")}</p>
        <h2>{t("billing.creditTitle")}</h2>
        <p className="muted">{t("billing.creditHelp")}</p>
        <ul>
          <li>{t("billing.creditPointOne")}</li>
          <li>{t("billing.creditPointTwo")}</li>
          <li>{t("billing.creditPointThree")}</li>
        </ul>
      </section>
      <section className="pack-grid">
        {packs.length ? (
          packs.map((pack) => (
            <div className="card" key={pack.id}>
              <p className="eyebrow">{t("billing.ai")}</p>
              <h2>{pack.name}</h2>
              <p>
                {pack.tokenCredits.toLocaleString(
                  language === "en" ? "en-GB" : "es-ES",
                )}{" "}
                {t("billing.available")}.
              </p>
              <button
                className="secondary"
                disabled={Boolean(busy) || (!pack.configured && !testCreditsEnabled)}
                onClick={() => checkout({ kind: "credits", packId: pack.id })}
              >
                {busy === pack.id
                  ? t("billing.opening")
                  : testCreditsEnabled
                    ? t("billing.addTestCredits")
                  : pack.configured
                    ? t("billing.buyPack")
                    : t("billing.comingSoon")}
              </button>
            </div>
          ))
        ) : (
          <div className="card">
            <h2>{t("billing.empty")}</h2>
            <p>{t("billing.emptyHelp")}</p>
          </div>
        )}
        <div className="card featured">
          <p className="eyebrow">{t("billing.plan")}</p>
          <h2>{t("billing.upgrade")}</h2>
          <p>{t("billing.upgradeHelp")}</p>
          <button
            className="primary"
            disabled={Boolean(busy)}
            onClick={() => checkout({ kind: "membership", planId: "growth" })}
          >
            {busy === "growth" ? t("billing.opening") : t("billing.viewGrowth")}
          </button>
        </div>
      </section>
      {message && <p className="success">{message}</p>}
    </main>
  );
}

function AdminGate() {
  const { session } = useApp();
  return isAdmin(session.role) ? <Admin /> : <Navigate to="/" replace />;
}
function McpPlanSettings() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [plan, setPlan] = useState<Record<string, any>>({ priceId: "", draftLimit: "", publishLimitPerMonth: "", trialDays: 0, enabled: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.mcpPlan().then(({ plan }) => { if (plan) setPlan(plan); }).catch((err) => showToast(err.message, "error")); }, []);
  return <form className="card settings-card mcp-plan-settings-card" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true);
    try { const result = await api.saveMcpPlan(plan); setPlan(result.plan); showToast(t("admin.saved")); }
    catch (err) { showToast(err instanceof Error ? err.message : t("common.error"), "error"); }
    finally { setBusy(false); }
  }}>
    <h2>{t("mcp.planConfig")}</h2><p className="muted">{t("mcp.billingHelp")}</p>
    <label>{t("mcp.price")}<input required value={plan.priceId} placeholder="price_…" onChange={(e) => setPlan({ ...plan, priceId: e.target.value })} /></label>
    <label>{t("mcp.draftLimit")}<input required type="number" min="1" step="1" value={plan.draftLimit} onChange={(e) => setPlan({ ...plan, draftLimit: e.target.value })} /></label>
    <label>{t("mcp.publishLimit")}<input required type="number" min="1" step="1" value={plan.publishLimitPerMonth} onChange={(e) => setPlan({ ...plan, publishLimitPerMonth: e.target.value })} /></label>
    <label>{t("mcp.trialDays")}<input type="number" min="0" max="365" step="1" value={plan.trialDays || 0} onChange={(e) => setPlan({ ...plan, trialDays: e.target.value })} /></label>
    <label className="switch-row"><span>{t("mcp.enabled")}</span><input type="checkbox" role="switch" checked={plan.enabled} onChange={(e) => setPlan({ ...plan, enabled: e.target.checked })} /></label>
    <button className="primary" disabled={busy}>{busy ? t("admin.saving") : t("common.save")}</button>
  </form>;
}

function MembershipGrantSettings({ site, users }: { site: string; users: Array<Record<string, any>> }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const eligibleUsers = users.filter((user) => (user.sites || []).includes(site));
  const [grant, setGrant] = useState<Record<string, any> | null>(null);
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState("complimentary");
  const [activeUntil, setActiveUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUserId((current) => eligibleUsers.some((user) => String(user.id) === current) ? current : String(eligibleUsers[0]?.id || ""));
  }, [site, users]);
  useEffect(() => {
    if (!userId) {
      setGrant(null);
      setReason("");
      return;
    }
    api.membershipGrant(site, userId).then(({ grant: next }) => {
      setGrant(next);
      setKind(String(next?.kind || "complimentary"));
      setActiveUntil(next?.activeUntil ? String(next.activeUntil).slice(0, 10) : "");
      setReason(String(next?.reason || ""));
    }).catch((err) => showToast(err.message, "error"));
  }, [site, userId]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.saveMembershipGrant({ site, userId, kind, activeUntil: activeUntil ? new Date(`${activeUntil}T23:59:59.999Z`).toISOString() : null, reason });
      setGrant(result.grant);
      showToast(t("admin.membershipGrantSaved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    try {
      const result = await api.revokeMembershipGrant(site, userId);
      setGrant(result.grant);
      showToast(t("admin.membershipGrantRevoked"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  };
  return <form className="card settings-card mcp-plan-settings-card" onSubmit={save}>
    <p className="eyebrow">{t("admin.membershipAccess")}</p>
    <h2>{t("admin.membershipGrantTitle")}</h2>
    <p className="muted">{t("admin.membershipGrantHelp")}</p>
    <div className="membership-grant-scope" role="note">
      <strong>{site}</strong>
      <span>{t("admin.membershipGrantTarget")}</span>
      <span>{t("admin.membershipGrantStripeNote")}</span>
    </div>
    <label>{t("admin.membershipGrantUser")}
      <select value={userId} onChange={(event) => { setUserId(event.target.value); setGrant(null); setKind("complimentary"); setActiveUntil(""); setReason(""); }} disabled={!eligibleUsers.length || busy}>
        {!eligibleUsers.length && <option value="">{t("admin.membershipGrantNoUsers")}</option>}
        {eligibleUsers.map((user) => <option key={String(user.id)} value={String(user.id)}>{String(user.displayName || user.email || user.id)}</option>)}
      </select>
    </label>
    <label>{t("admin.membershipGrantType")}<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="complimentary">{t("admin.membershipGrantComplimentary")}</option><option value="trial">{t("admin.membershipGrantTrial")}</option></select></label>
    <label>{t("admin.membershipGrantUntil")}<input type="date" value={activeUntil} onChange={(event) => setActiveUntil(event.target.value)} /><small>{t("admin.membershipGrantUntilHelp")}</small></label>
    <label>{t("admin.membershipGrantReason")}<input required maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("admin.membershipGrantReasonPlaceholder")} /></label>
    <div className="form-actions"><button className="primary" disabled={busy || !userId}>{busy ? t("admin.saving") : t("admin.saveMembershipGrant")}</button><button type="button" className="danger-link" disabled={busy || !grant} onClick={() => void revoke()}>{t("admin.revokeMembershipGrant")}</button></div>
    {grant && <p className="tiny">{grant.active ? t("admin.membershipGrantActive") : t("admin.membershipGrantInactive")}{grant.activeUntil ? ` · ${String(grant.activeUntil).slice(0, 10)}` : ""}</p>}
  </form>;
}
function Admin() {
  const { site, session, setSite, refresh } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const canIssueSiteToken = session.role === "admin";
  const [adminScope, setAdminScope] = useState<"site" | "global">(
    session.role === "admin" ? "global" : "site",
  );
  const [sites, setSites] = useState<string[]>([]);
  const [showCreateSite, setShowCreateSite] = useState(false);
  const [newSiteForm, setNewSiteForm] = useState({
    handle: "",
    name: "",
    domain: "",
    authors: "",
    rebuildWebhookUrl: "",
    coolifyApiToken: "",
    requiresHumanApproval: true,
  });
  const [newSiteSaving, setNewSiteSaving] = useState(false);
  const [brand, setBrand] = useState("");
  const [brandFiles, setBrandFiles] = useState<string[]>([]);
  const [selectedBrandFile, setSelectedBrandFile] = useState("");
  const [brandContent, setBrandContent] = useState("");
  const [brandSaving, setBrandSaving] = useState(false);
  const [referenceMedia, setReferenceMedia] = useState<MediaItem[]>([]);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [selectedReference, setSelectedReference] = useState<MediaItem | null>(null);
  const [showBrandAi, setShowBrandAi] = useState(false);
  const [brandAiBusy, setBrandAiBusy] = useState(false);
  const [brandZipBusy, setBrandZipBusy] = useState(false);
  const brandZipInputRef = useRef<HTMLInputElement | null>(null);
  const [users, setUsers] = useState<Array<Record<string, any>>>([]);
  const [userForm, setUserForm] = useState<{
    id?: string;
    email: string;
    role: string;
    sites: string[];
    allowPublishingAs?: boolean;
  } | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<Record<string, any> | null>(null);
  const [onboarding, setOnboarding] = useState<Record<string, any> | null>(
    null,
  );
  const [siteConfig, setSiteConfig] = useState<Record<string, any> | null>(null);
  const [siteForm, setSiteForm] = useState({
    name: "",
    domain: "",
    rebuildWebhookUrl: "",
    coolifyApiToken: "",
    clearCoolifyApiToken: false,
    blogEnabled: true,
    reviewMode: "direct",
    planId: "standard",
    socialPackChannels: { ...DEFAULT_SOCIAL_PACK_CHANNELS },
  });
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteToken, setSiteToken] = useState("");
  const [teamUnavailable, setTeamUnavailable] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [providers, setProviders] = useState<
    Array<{
      provider: string;
      name: string;
      enabled: boolean;
      model: string;
      apiKeyConfigured: boolean;
      apiKeyHint?: string;
      credentialSource: string;
    }>
  >([]);
  const [modelCatalog, setModelCatalog] = useState<
    Array<{ id: string; name: string; provider: string }>
  >([]);
  const [packs, setPacks] = useState<
    Array<{
      id: string;
      name: string;
      tokenCredits: number;
      configured: boolean;
    }>
  >([]);
  const [editingPack, setEditingPack] = useState<{
    id: string;
    name: string;
    tokenCredits: number;
    configured: boolean;
  } | null>(null);
  const [pendingDeletePack, setPendingDeletePack] = useState<string | null>(
    null,
  );
  const [billingTestMode, setBillingTestMode] = useState(false);
  const [billingTestSaving, setBillingTestSaving] = useState(false);
  const [cmsAiEnabled, setCmsAiEnabled] = useState(true);
  const [cmsAiSaving, setCmsAiSaving] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [blogWizardEnabled, setBlogWizardEnabled] = useState(true);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const report = (value: string, kind: "success" | "error" = "success") => {
    setMessageKind(kind);
    setMessage(value);
    showToast(value, kind);
  };
  const createSite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const handle = newSiteForm.handle.trim().toLowerCase();
    const domain = newSiteForm.domain.trim().replace(/\/$/, "");
    if (!/^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(handle)) {
      report(t("admin.siteHandleInvalid"), "error");
      return;
    }
    if (!/^https?:\/\//i.test(domain)) {
      report(t("admin.siteDomainInvalid"), "error");
      return;
    }
    setNewSiteSaving(true);
    try {
      const authors = newSiteForm.authors
        .split(",")
        .map((author) => author.trim())
        .filter(Boolean);
      const input: Parameters<typeof api.createSite>[0] = {
        handle,
        name: newSiteForm.name.trim() || handle,
        domain,
        requiresHumanApproval: newSiteForm.requiresHumanApproval,
      };
      if (authors.length) input.authors = authors;
      if (newSiteForm.rebuildWebhookUrl.trim()) input.rebuildWebhookUrl = newSiteForm.rebuildWebhookUrl.trim();
      if (newSiteForm.coolifyApiToken.trim()) input.coolifyApiToken = newSiteForm.coolifyApiToken.trim();
      const result = await api.createSite(input);
      const siteData = await api.sites();
      setSites(siteData.handles || []);
      setShowCreateSite(false);
      setNewSiteForm({
        handle: "",
        name: "",
        domain: "",
        authors: "",
        rebuildWebhookUrl: "",
        coolifyApiToken: "",
        requiresHumanApproval: true,
      });
      await refresh();
      setSite(result.site.handle);
      report(`${t("admin.siteCreated")} ${result.site.handle}`);
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setNewSiteSaving(false);
    }
  };
  const loadAiBilling = async () => {
    try {
      const featureFlagData = await api.featureFlags();
      const enabled = featureFlagData.flags?.cmsAiEnabled !== false;
      setCmsAiEnabled(enabled);
      setBillingTestMode(Boolean(featureFlagData.flags?.creditCheckoutWithoutStripe));
      setAssistantEnabled(enabled && featureFlagData.flags?.assistantEnabled !== false);
      setBlogWizardEnabled(enabled && featureFlagData.flags?.blogWizardEnabled !== false);
      if (!enabled) {
        setProviders([]);
        setPacks([]);
        setModelCatalog([]);
        return;
      }
      const [providerData, packData, billingData] = await Promise.all([
        api.aiProviders(),
        api.creditPacks(),
        api.billing(site).catch(() => ({ models: [] })),
      ]);
      setProviders(providerData.providers);
      setPacks(packData.packs);
      setModelCatalog(
        ((billingData as Record<string, any>).models || []).map((model: any) => ({
          id: String(model.id || ""),
          name: String(model.name || model.id || ""),
          provider: String(model.provider || ""),
        })).filter((model: { id: string }) => model.id),
      );
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    }
  };
  useEffect(() => {
    api
      .sites()
      .then((data) => setSites(data.handles))
      .catch((e) => report(e.message, "error"));
    api
      .brand(site)
      .then((data) => {
        setBrand(data.summary || "");
        setBrandFiles(data.files || []);
      })
      .catch(() => {});
    api
      .media(site, "reference")
      .then((data) => setReferenceMedia(data.media || []))
      .catch(() => setReferenceMedia([]));
    api
      .users(site, session.role === "admin")
      .then((data) => {
        setUsers(data.users || []);
        setTeamUnavailable(false);
      })
      .catch(() => setTeamUnavailable(true));
    api
      .onboarding(site)
      .then(setOnboarding)
      .catch(() => setOnboarding(null));
    api
      .siteConfig(site)
      .then((data) => {
        setSiteConfig(data.config || null);
        setSiteForm({
          name: String(data.config?.name || ""),
          domain: String(data.config?.domain || ""),
          rebuildWebhookUrl: String(data.config?.rebuildWebhookUrl || ""),
          // The API intentionally redacts the token. Keep the field empty so
          // saving without typing a new value preserves the existing secret.
          coolifyApiToken: "",
          clearCoolifyApiToken: false,
          blogEnabled: data.config?.blogEnabled !== false,
          reviewMode: String(data.config?.reviewMode || "direct"),
          planId: String(data.config?.planId || "standard"),
          socialPackChannels: {
            ...DEFAULT_SOCIAL_PACK_CHANNELS,
            ...(data.config?.socialPackChannels || {}),
          },
        });
      })
      .catch(() => setSiteConfig(null));
    if (session.role === "admin") void loadAiBilling();
  }, [site, session.role]);
  useEffect(() => {
    if (!selectedBrandFile) return;
    api
      .brandFile(site, selectedBrandFile)
      .then((data) => setBrandContent(data.content || ""))
      .catch(() => setBrandContent(""));
  }, [site, selectedBrandFile]);
  const saveBrand = async () => {
    if (!selectedBrandFile) return;
    setBrandSaving(true);
    try {
      await api.saveBrandFile(site, selectedBrandFile, brandContent);
      report(t("admin.savedBrand"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBrandSaving(false);
    }
  };
  const importBrandZip = async (file?: File) => {
    if (!file) return;
    setBrandZipBusy(true);
    try {
      const result = await api.importBrandZip(site, await fileAsBase64(file));
      const data = await api.brand(site);
      setBrandFiles(data.files || []);
      setBrand(data.summary || "");
      const refs = await api.media(site, "reference").catch(() => ({ media: [] }));
      setReferenceMedia(refs.media || []);
      report(`${t("admin.brandZipImported")} ${(result.importedImages || []).length} ${t("admin.brandZipImages")}`);
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBrandZipBusy(false);
      if (brandZipInputRef.current) brandZipInputRef.current.value = "";
    }
  };
  const generateBrandFile = async (prompt: string) => {
    if (!selectedBrandFile || !prompt) return;
    setBrandAiBusy(true);
    setMessage("");
    try {
      const result = await api.aiGenerate({
        site,
        operation: "brand-file",
        prompt: `${prompt}\n\nArchivo actual (${selectedBrandFile}):\n${brandContent}`,
      });
      if (result.content) {
        setBrandContent(result.content);
        report(t("admin.brandAiReady"));
      }
      setShowBrandAi(false);
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBrandAiBusy(false);
    }
  };
  const uploadReference = async (file: File) => {
    setReferenceBusy(true);
    try {
      const contentBase64 = await fileAsBase64(file);
      const result = await api.uploadMedia({
        site,
        filename: file.name,
        contentBase64,
        kind: "reference",
        alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      });
      setReferenceMedia((current) => [result.media, ...current]);
      report(t("admin.referenceUploaded"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setReferenceBusy(false);
    }
  };
  const deleteReference = async (media: MediaItem) => {
    setReferenceBusy(true);
    try {
      await api.deleteMedia({ site, id: media.id, path: media.path });
      setReferenceMedia((current) => current.filter((item) => item.id !== media.id && item.path !== media.path));
      report(t("admin.referenceDeleted"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setReferenceBusy(false);
    }
  };
  const saveReference = async (media: MediaItem, alt: string) => {
    if (!media.id) return;
    setReferenceBusy(true);
    try {
      const result = await api.updateMediaAlt({ site, id: media.id, alt });
      setReferenceMedia((current) => current.map((item) => item.id === media.id ? result.media : item));
      setSelectedReference(result.media);
      report(t("admin.referenceSaved"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setReferenceBusy(false);
    }
  };
  const saveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userForm) return;
    setUserBusy(true);
    let invitationMessage = "";
    try {
      if (userForm.id) {
        await api.updateUser({ id: userForm.id, email: userForm.email, role: userForm.role, sites: userForm.sites, allowPublishingAs: userForm.allowPublishingAs });
      } else {
        const result = await api.registerUser({ email: userForm.email, role: userForm.role, sites: userForm.sites, invite: true });
        if (result.invite?.link) {
          await navigator.clipboard?.writeText(result.invite.link).catch(() => {});
          invitationMessage = `${t("admin.magicLinkReady")} ${result.invite.link}`;
        } else if (result.invite?.transport) {
          invitationMessage = t("admin.magicLinkSent");
        }
      }
      const data = await api.users(site, session.role === "admin");
      setUsers(data.users || []);
      setUserForm(null);
      report(invitationMessage || t("admin.userSaved"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setUserBusy(false);
    }
  };
  const deleteUser = async () => {
    if (!pendingDeleteUser?.id) return;
    setUserBusy(true);
    try {
      await api.deleteUser({ id: pendingDeleteUser.id, site });
      setUsers((current) => current.filter((user) => user.id !== pendingDeleteUser.id));
      report(t("admin.userDeleted"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setUserBusy(false);
      setPendingDeleteUser(null);
    }
  };
  const issueUserToken = async (user: Record<string, any>) => {
    if (!user.id) return;
    setUserBusy(true);
    try {
      const result = await api.issueUserToken(user.id);
      await navigator.clipboard?.writeText(result.token).catch(() => {});
      report(`${t("admin.userTokenReady")} ${result.token}`);
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setUserBusy(false);
    }
  };
  const revokeUserToken = async (user: Record<string, any>) => {
    if (!user.id) return;
    setUserBusy(true);
    try {
      await api.revokeUserToken(user.id);
      setUsers((current) => current.map((row) => row.id === user.id ? { ...row, hasLoginToken: false, loginTokenHint: "" } : row));
      report(t("admin.userTokenRevoked"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setUserBusy(false);
    }
  };
  const sendUserMagicLink = async (user: Record<string, any>) => {
    const email = String(user.email || "").trim();
    if (!email) return;
    setUserBusy(true);
    try {
      const result = await api.sendMagicLink({
        email,
        site,
        role: String(user.role || "client"),
      });
      if (result.link) {
        await navigator.clipboard?.writeText(result.link).catch(() => {});
        report(`${t("admin.magicLinkReady")} ${result.link}`);
      } else {
        report(t("admin.magicLinkSent"));
      }
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setUserBusy(false);
    }
  };
  const saveSite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSiteSaving(true);
    try {
      const result = await api.saveSiteConfig(site, {
        ...siteForm,
        coolifyApiToken: siteForm.coolifyApiToken.trim(),
        reviewMode: "direct",
        requiresPublishConfirmation: false,
      });
      setSiteConfig(result.config);
      setSiteForm((current) => ({ ...current, coolifyApiToken: "", clearCoolifyApiToken: false }));
      report(t("admin.siteSaved"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSiteSaving(false);
    }
  };
  const testSite = async () => {
    setSiteSaving(true);
    try {
      const result = await api.testSiteRebuild(site);
      report(result.message || t("admin.siteTested"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSiteSaving(false);
    }
  };
  const issueSiteToken = async () => {
    setSiteSaving(true);
    try {
      const result = await api.issueSiteToken(site, true);
      setSiteToken(result.siteAccessToken || "");
      report(t("admin.siteTokenReady"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSiteSaving(false);
    }
  };
  const saveProvider = async (
    provider: {
      provider: string;
      name: string;
      enabled: boolean;
      model: string;
    },
    form: HTMLFormElement,
  ) => {
    const fields = new FormData(form);
    setBusy(`provider:${provider.provider}`);
    setMessage("");
    try {
      await api.saveAiProvider({
        provider: provider.provider,
        enabled: fields.get("enabled") === "on",
        model: String(fields.get("model") || ""),
        apiKey: String(fields.get("apiKey") || ""),
      });
      report(
        `${provider.name || provider.provider}: ${t("admin.savedProvider")}`,
      );
      await loadAiBilling();
      form.reset();
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy("");
    }
  };
  const testProvider = async (provider: string) => {
    setBusy(`test:${provider}`);
    setMessage("");
    try {
      const { result } = await api.testAiProvider(provider);
      const reason = result.reason === "api_key_missing"
        ? t("admin.testMissingKey")
        : result.reason === "provider_request_failed"
          ? `${t("admin.testProviderFailed")}${result.status ? ` (${result.status})` : ""}`
          : result.reason || t("common.error");
      report(
        result.ok
          ? `${provider}: ${t("admin.testSuccess")}${result.latencyMs ? ` (${result.latencyMs} ms)` : ""}.`
          : `${provider}: ${reason}`,
      );
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy("");
    }
  };
  const savePack = async (form: HTMLFormElement) => {
    const fields = new FormData(form);
    setBusy("pack");
    setMessage("");
    try {
      await api.saveCreditPack({
        id: String(fields.get("id") || ""),
        name: String(fields.get("name") || ""),
        tokenCredits: Number(fields.get("tokenCredits") || 0),
        priceId: String(fields.get("priceId") || ""),
      });
      report(t("admin.savedPack"));
      setEditingPack(null);
      form.reset();
      await loadAiBilling();
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy("");
    }
  };
  const saveBillingTestMode = async () => {
    setBillingTestSaving(true);
    try {
      const result = await api.saveFeatureFlags({ creditCheckoutWithoutStripe: billingTestMode });
      setBillingTestMode(Boolean(result.flags?.creditCheckoutWithoutStripe));
      report(t("admin.savedBillingTestMode"));
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBillingTestSaving(false);
    }
  };
  const saveCmsAiFlag = async (enabled: boolean) => {
    const previous = cmsAiEnabled;
    setCmsAiEnabled(enabled);
    setCmsAiSaving(true);
    try {
      const result = await api.saveFeatureFlags({ cmsAiEnabled: enabled });
      const saved = result.flags?.cmsAiEnabled !== false;
      setCmsAiEnabled(saved);
      if (!saved) {
        setProviders([]);
        setPacks([]);
        setModelCatalog([]);
        setAssistantEnabled(false);
        setBlogWizardEnabled(false);
      } else {
        await loadAiBilling();
      }
      report(t("admin.savedCmsAiFlag"));
      await refresh();
    } catch (err) {
      setCmsAiEnabled(previous);
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setCmsAiSaving(false);
    }
  };
  const saveWorkflowFlags = async () => {
    setWorkflowSaving(true);
    try {
      const result = await api.saveFeatureFlags({ assistantEnabled, blogWizardEnabled });
      setAssistantEnabled(result.flags?.assistantEnabled !== false);
      setBlogWizardEnabled(result.flags?.blogWizardEnabled !== false);
      report(t("admin.savedWorkflowFlags"));
      await refresh();
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setWorkflowSaving(false);
    }
  };
  const removePack = async (id: string) => {
    setPendingDeletePack(id);
  };
  const confirmRemovePack = async () => {
    const id = pendingDeletePack;
    if (!id) return;
    setBusy(`delete:${id}`);
    try {
      await api.deleteCreditPack(id);
      report(t("admin.deletedPack"));
      await loadAiBilling();
    } catch (err) {
      report(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy("");
      setPendingDeletePack(null);
    }
  };
  return (
    <main className={`page admin-page scope-${adminScope}`}>
      <PageTitle
        eyebrow={t("admin.eyebrow")}
        title={t("admin.title")}
        description={t("admin.description")}
        back
      />
      {message && (
        <div className={`feedback-banner ${messageKind}`} role="status">
          {message}
        </div>
      )}
      {session.role === "admin" && (
        <div className="admin-scope-toolbar">
          <div className="admin-scope-switch" role="tablist" aria-label={t("admin.scopeSwitch")}>
            <button type="button" role="tab" aria-selected={adminScope === "site"} className={adminScope === "site" ? "selected" : ""} onClick={() => setAdminScope("site")}>{t("admin.siteScope")}</button>
            <button type="button" role="tab" aria-selected={adminScope === "global"} className={adminScope === "global" ? "selected" : ""} onClick={() => setAdminScope("global")}>{t("admin.workspaceScope")}</button>
          </div>
          <button className="primary" type="button" onClick={() => setShowCreateSite(true)}>
            ＋ {t("admin.addSite")}
          </button>
        </div>
      )}
      <div className="admin-scope-summary">
        <div>
          <p className="admin-scope-kicker">{t("admin.workspaceScope")}</p>
          <p>{t("admin.workspaceScopeHelp")}</p>
        </div>
        <div>
          <p className="admin-scope-kicker">{t("admin.siteScope")}</p>
          <p>{t("admin.siteScopeHelp")}</p>
        </div>
      </div>
      <div className="admin-grid">
        <section className="card admin-workspace-card">
          <p className="admin-scope-kicker">{t("admin.workspaceScope")}</p>
          <h2>{t("admin.sites")}</h2>
          {sites.length ? (
            <ul className="admin-site-list">
              {sites.map((handle) => (
                <li key={handle}>
                  <button
                    type="button"
                    className={`admin-site-option ${site === handle ? "active" : ""}`}
                    aria-current={site === handle ? "page" : undefined}
                    onClick={() => {
                      setSite(handle);
                      setAdminScope("site");
                    }}
                  >
                    <span className="admin-site-option-dot" aria-hidden="true">●</span>
                    <strong>{handle}</strong>
                    <span className="admin-site-option-arrow" aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("common.loading")}</p>
          )}
        </section>
        <section className="card admin-site-card">
          <p className="admin-scope-kicker">{t("admin.siteScope")}</p>
          <div className="section-title">
            <h2>{t("admin.brand")}</h2>
            {session.role === "admin" && (
              <label className="secondary upload-reference-button">
                {brandZipBusy ? t("admin.saving") : t("admin.importBrandZip")}
                <input
                  ref={brandZipInputRef}
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  hidden
                  disabled={brandZipBusy}
                  onChange={(event) => void importBrandZip(event.target.files?.[0])}
                />
              </label>
            )}
          </div>
          <p className="muted">{brand || t("admin.brand")}</p>
          {brandFiles.length ? (
            <div className="file-list">
              {brandFiles.slice(0, 8).map((file) => (
                <button
                  key={file}
                  type="button"
                  className={`file-chip ${selectedBrandFile === file ? "selected" : ""}`}
                  onClick={() => setSelectedBrandFile(file)}
                >
                  {file}
                </button>
              ))}
            </div>
          ) : (
            <p className="tiny">{t("admin.brandEmpty")}</p>
          )}
          {selectedBrandFile && (
            <div className="brand-file-editor">
              <textarea
                value={brandContent}
                onChange={(e) => setBrandContent(e.target.value)}
                rows={8}
                aria-label={selectedBrandFile}
              />
              <div className="form-actions">
                <AiOnly><button
                  className="ghost"
                  type="button"
                  disabled={brandSaving || brandAiBusy}
                  onClick={() => setShowBrandAi(true)}
                >
                  {t("admin.brandAiAction")}
                </button></AiOnly>
                <button
                  className="secondary"
                  type="button"
                  disabled={brandSaving}
                  onClick={() => void saveBrand()}
                >
                  {brandSaving ? t("admin.saving") : t("admin.saveBrand")}
                </button>
              </div>
            </div>
          )}
          <p className="tiny">{t("admin.brandSimple")}</p>
          <div className="reference-library">
            <div className="section-title">
              <div>
                <p className="eyebrow">{t("admin.referencesEyebrow")}</p>
                <h3>{t("admin.referencesTitle")}</h3>
              </div>
              <label className="secondary upload-reference-button">
                {referenceBusy ? t("admin.saving") : t("admin.referenceAdd")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  disabled={referenceBusy}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    files.forEach((file) => void uploadReference(file));
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <p className="tiny">{t("admin.referencesHelp")}</p>
            {referenceMedia.length ? (
              <div className="reference-grid">
                {referenceMedia.map((media) => (
                  <article className="reference-card" key={media.id || media.path}>
                    <button
                      className="reference-image-button"
                      type="button"
                      onClick={() => setSelectedReference(media)}
                      aria-label={`${t("admin.referenceEditTitle")}: ${media.filename || t("admin.referenceImage")}`}
                    >
                      <img src={media.thumbUrl || media.url || media.path} alt={media.alt || ""} />
                      <span className="reference-edit-icon" aria-hidden="true">✎</span>
                    </button>
                    <div className="reference-card-actions">
                      <span className="reference-kind-icon" title={t("admin.referenceBadge")} aria-hidden="true">✦</span>
                      <button
                        className="icon-button reference-delete-button"
                        type="button"
                        disabled={referenceBusy}
                        onClick={() => void deleteReference(media)}
                        aria-label={t("admin.delete")}
                        title={t("admin.delete")}
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty">{t("admin.referencesEmpty")}</p>
            )}
          </div>
        </section>
        <section className="card admin-workspace-card">
          <p className="admin-scope-kicker">{t("admin.workspaceScope")}</p>
          <div className="section-title">
            <h2>{t("admin.users")}</h2>
            <button
              className="secondary"
              type="button"
              onClick={() => setUserForm({ email: "", role: "client", sites: [site], allowPublishingAs: false })}
            >
              <AdminActionIcon kind="plus" />
              {t("admin.addUser")}
            </button>
          </div>
          {teamUnavailable ? (
            <p className="muted">{t("admin.usersUnavailable")}</p>
          ) : users.length ? (
            <ul className="user-list">
              {users.map((user) => (
                <li key={user.id || user.email}>
                  <div className="admin-user-summary">
                    <UserAvatar src={user.avatarUrl} name={user.displayName || user.email || user.name} size="sm" />
                    <div className="admin-user-copy">
                      <strong>{user.displayName || user.email || user.name || t("admin.user")}</strong>
                      <span>{user.email && user.displayName ? `${user.email} · ` : ""}{roleLabel(user.role, t)} · {(user.sites || [user.site]).filter(Boolean).join(", ")}{user.allowPublishingAs ? " · ✦ autor" : ""}</span>
                    </div>
                  </div>
                  <div className="user-actions">
                    <button
                      className="admin-icon-action"
                      type="button"
                      onClick={() => setUserForm({ id: user.id, email: user.email || "", role: user.role || "client", sites: user.sites || [user.site || site], allowPublishingAs: Boolean(user.allowPublishingAs) })}
                      aria-label={t("admin.editUser")}
                      title={t("admin.editUser")}
                    >
                      <AdminActionIcon kind="edit" />
                    </button>
                    <button
                      className="admin-icon-action"
                      type="button"
                      disabled={userBusy}
                      onClick={() => user.hasLoginToken ? void revokeUserToken(user) : void issueUserToken(user)}
                      aria-label={user.hasLoginToken ? t("admin.revokeToken") : t("admin.issueToken")}
                      title={user.hasLoginToken ? t("admin.revokeToken") : t("admin.issueToken")}
                    >
                      <AdminActionIcon kind="key" />
                    </button>
                    <button
                      className="admin-icon-action"
                      type="button"
                      disabled={userBusy}
                      onClick={() => void sendUserMagicLink(user)}
                      aria-label={t("admin.magicLink")}
                      title={t("admin.magicLink")}
                    >
                      <AdminActionIcon kind="mail" />
                    </button>
                    <button
                      className="admin-icon-action danger"
                      type="button"
                      disabled={userBusy}
                      onClick={() => setPendingDeleteUser(user)}
                      aria-label={t("admin.delete")}
                      title={t("admin.delete")}
                    >
                      <AdminActionIcon kind="trash" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("admin.noUsers")}</p>
          )}
          <p className="tiny">{t("admin.usersHelp")}</p>
          {userForm && (
            <form className="user-editor form-stack" onSubmit={(event) => void saveUser(event)}>
              <h3>{userForm.id ? t("admin.editUser") : t("admin.addUser")}</h3>
              <label>
                {t("admin.userEmail")}
                <input type="email" required value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} autoComplete="email" />
              </label>
              <label>
                {t("admin.userRole")}
                <ChoicePills
                  value={userForm.role}
                  ariaLabel={t("admin.userRole")}
                  onChange={(value) => setUserForm({ ...userForm, role: value })}
                  options={[
                    { value: "client", label: roleLabel("client", t) },
                    { value: "client_mcp", label: roleLabel("client_mcp", t) },
                    { value: "agency_admin", label: roleLabel("agency_admin", t) },
                  ]}
                />
              </label>
              <fieldset className="site-checks">
                <legend>{t("admin.userSites")}</legend>
                {sites.map((handle) => (
                  <label key={handle} className="checkbox-label">
                    <input type="checkbox" checked={userForm.sites.includes(handle)} onChange={(event) => setUserForm({ ...userForm, sites: event.target.checked ? [...new Set([...userForm.sites, handle])] : userForm.sites.filter((item) => item !== handle) })} />
                    {handle}
                  </label>
                ))}
              </fieldset>
              <label className="switch-row">
                <span><b>{t("settings.authorPermission")}</b><small>{t("settings.authorPermissionHelp")}</small></span>
                <input type="checkbox" checked={Boolean(userForm.allowPublishingAs)} onChange={(event) => setUserForm({ ...userForm, allowPublishingAs: event.target.checked })} />
              </label>
              <div className="form-actions">
                <button className="ghost" type="button" onClick={() => setUserForm(null)}>{t("editor.close")}</button>
                <button className="primary" disabled={userBusy || !userForm.sites.length}>{userBusy ? t("admin.saving") : t("admin.save")}</button>
              </div>
            </form>
          )}
        </section>
        <section className="card admin-site-card">
          <p className="admin-scope-kicker">{t("admin.siteScope")}</p>
          <h2>{t("admin.connection")}</h2>
          <p className="connection-state">
            <span
              className={`status-dot ${onboarding?.site?.domain && !String(onboarding.site.domain).includes("tu-dominio") ? "online" : "offline"}`}
            />
            {onboarding?.site?.domain &&
            !String(onboarding.site.domain).includes("tu-dominio")
              ? t("admin.connected")
              : t("admin.connectionPending")}
          </p>
          <p className="muted">
            {onboarding?.site?.domain || t("admin.connectionHelp")}
          </p>
          <p className="tiny">{t("admin.connectionSimple")}</p>
          {siteConfig && (
            <form className="site-connection-form form-stack" onSubmit={(event) => void saveSite(event)}>
              <label>
                {t("admin.siteName")}
                <input value={siteForm.name} onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })} />
              </label>
              <label>
                {t("admin.siteDomain")}
                <input type="url" value={siteForm.domain} onChange={(event) => setSiteForm({ ...siteForm, domain: event.target.value })} />
              </label>
              <label>
                {t("admin.rebuildWebhook")}
                <input value={siteForm.rebuildWebhookUrl} onChange={(event) => setSiteForm({ ...siteForm, rebuildWebhookUrl: event.target.value })} placeholder="https://..." />
              </label>
              <label>
                {t("admin.coolifyToken")} <span className="optional">
                  {siteConfig.hasCoolifyApiToken
                    ? `${t("admin.configured")} · ${siteConfig.coolifyApiTokenHint || "••••"}`
                    : t("admin.notConfigured")}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={siteForm.coolifyApiToken}
                  onChange={(event) => setSiteForm({ ...siteForm, coolifyApiToken: event.target.value })}
                  placeholder={t("admin.coolifyTokenPlaceholder")}
                />
                <span className="tiny form-help">{t("admin.coolifyTokenHelp")}</span>
              </label>
              {siteConfig.hasCoolifyApiToken && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={siteForm.clearCoolifyApiToken}
                    onChange={(event) => setSiteForm({ ...siteForm, clearCoolifyApiToken: event.target.checked })}
                  />
                  {t("admin.clearCoolifyToken")}
                </label>
              )}
              <label className="checkbox-label">
                <input type="checkbox" checked={siteForm.blogEnabled} onChange={(event) => setSiteForm({ ...siteForm, blogEnabled: event.target.checked })} />
                {t("admin.blogEnabled")}
              </label>
              <fieldset className="social-pack-channel-settings">
                <legend>{t("admin.socialPackChannels")}</legend>
                <p className="tiny">{t("admin.socialPackChannelsHelp")}</p>
                {SOCIAL_PACK_CHANNEL_KEYS.map(({ key, labelKey }) => (
                  <label className="checkbox-label" key={key}>
                    <input
                      type="checkbox"
                      checked={siteForm.socialPackChannels[key]}
                      onChange={(event) => setSiteForm({
                        ...siteForm,
                        socialPackChannels: {
                          ...siteForm.socialPackChannels,
                          [key]: event.target.checked,
                        },
                      })}
                    />
                    {t(labelKey)}
                  </label>
                ))}
              </fieldset>
              <label>
                {t("admin.sitePlan")}
                <ChoicePills
                  value={siteForm.planId}
                  ariaLabel={t("admin.sitePlan")}
                  onChange={(value) => setSiteForm({ ...siteForm, planId: value })}
                  options={[
                    { value: "standard", label: t("admin.sitePlanStandard") },
                    { value: "mcp", label: t("admin.sitePlanMcp") },
                  ]}
                />
                <span className="tiny">{t("admin.sitePlanHelp")}</span>
              </label>
              <div className="form-actions">
                <button className="ghost" type="button" disabled={siteSaving} onClick={() => void testSite()}>{t("admin.testRebuild")}</button>
                <button className="primary" disabled={siteSaving}>{siteSaving ? t("admin.saving") : t("admin.save")}</button>
              </div>
              {canIssueSiteToken && (
                <div className="site-token-box">
                  <div>
                    <strong>{t("admin.siteToken")}</strong>
                    <p className="tiny">{t("admin.siteTokenHelp")}</p>
                  </div>
                  <button className="ghost" type="button" disabled={siteSaving} onClick={() => void issueSiteToken()}>{t("admin.issueSiteToken")}</button>
                  {siteToken && <code>{siteToken}</code>}
                </div>
              )}
            </form>
          )}
        </section>
      </div>
      {session.role === "admin" ? (
        <section className="admin-ai">
          <section className={`card cms-ai-status-card ${cmsAiEnabled ? "" : "is-disabled"}`}>
            <p className="eyebrow">{t("admin.cmsAiFlagEyebrow")}</p>
            <h2>{cmsAiEnabled ? t("admin.cmsAiFlagTitle") : t("admin.cmsAiDisabledTitle")}</h2>
            <p className="muted">{cmsAiEnabled ? t("admin.cmsAiFlagHelp") : t("admin.cmsAiDisabledHelp")}</p>
            <label className="switch-row">
              <span>
                <b>{t("admin.cmsAiFlagToggle")}</b>
                <small>{cmsAiSaving ? t("admin.saving") : cmsAiEnabled ? t("admin.cmsAiFlagOn") : t("admin.cmsAiFlagOff")}</small>
              </span>
              <input type="checkbox" checked={cmsAiEnabled} disabled={cmsAiSaving} onChange={(event) => void saveCmsAiFlag(event.target.checked)} />
            </label>
          </section>
          {session.role === "admin" && <>
            <div className="section-title membership-section-title">
              <div>
                <p className="eyebrow">{t("admin.membershipAccess")}</p>
                <h2>{t("admin.membershipBillingTitle")}</h2>
                <p className="muted">{t("admin.membershipBillingHelp")}</p>
              </div>
            </div>
            <div className="membership-settings-grid">
              <MembershipGrantSettings site={site} users={users} />
              <McpPlanSettings />
            </div>
          </>}
          {cmsAiEnabled ? <>
          <div className="section-title">
            <div>
              <p className="eyebrow">{t("admin.workspaceScope")}</p>
              <p className="admin-scope-kicker">{t("admin.aiBilling")}</p>
              <h2>{t("admin.connectors")}</h2>
            </div>
            <button
              className="ghost"
              onClick={() => void loadAiBilling()}
              disabled={Boolean(busy)}
            >
              {t("admin.refresh")}
            </button>
          </div>
          <p className="tiny refresh-help">{t("admin.refreshHelp")}</p>
          <p className="muted">{t("admin.secretHelp")}</p>
          <div className="admin-ai-grid">
            {providers.map((provider) => (
              <form
                className="card form-stack"
                key={provider.provider}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveProvider(provider, event.currentTarget);
                }}
              >
                <div>
                  <p className="eyebrow">{provider.provider}</p>
                  <h3>{provider.name}</h3>
                </div>
                <label>
                  {t("admin.model")}
                  <ModelPicker
                    name="model"
                    value={provider.model}
                    ariaLabel={`${t("admin.model")} ${provider.name}`}
                    options={[
                      ...(!modelCatalog.some(
                        (model) => model.id === provider.model,
                      )
                        ? [{ value: provider.model, label: provider.model }]
                        : []),
                      ...modelCatalog
                        .filter((model) => model.provider === provider.provider)
                        .map((model) => ({ value: model.id, label: model.name })),
                    ]}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={provider.enabled}
                  />{" "}
                  {t("admin.enableConnector")}
                </label>
                <label>
                  {t("admin.apiKey")}{" "}
                  <span className="optional">
                    {provider.apiKeyConfigured
                      ? `${provider.apiKeyHint || t("admin.configured")} · ${provider.credentialSource}`
                      : t("admin.notConfigured")}
                  </span>
                  <input
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    placeholder={provider.apiKeyHint || t("admin.apiKeyPlaceholder")}
                  />
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy === `test:${provider.provider}`}
                    onClick={() => void testProvider(provider.provider)}
                  >
                    {busy === `test:${provider.provider}`
                      ? t("admin.testing")
                      : t("admin.test")}
                  </button>
                  <button
                    className="primary"
                    disabled={busy === `provider:${provider.provider}`}
                  >
                    {busy === `provider:${provider.provider}`
                      ? t("admin.saving")
                      : t("admin.save")}
                  </button>
                </div>
              </form>
            ))}
          </div>
          <div className="section-title admin-pack-title">
            <div>
              <p className="eyebrow">{t("admin.stripe")}</p>
              <h2>{t("admin.creditPacks")}</h2>
            </div>
          </div>
          <p className="muted pack-help">{t("admin.packHelp")}</p>
          <div className="admin-ai-grid">
            {packs.map((pack) => (
              <article className="card" key={pack.id}>
                <p className="eyebrow">
                  {pack.configured
                    ? t("admin.checkoutActive")
                    : t("admin.noPrice")}
                </p>
                <h3>{pack.name}</h3>
                <p className="muted">
                  {pack.tokenCredits.toLocaleString("es-ES")}{" "}
                  {t("admin.credits")} · {pack.id}
                </p>
                <div className="form-actions pack-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setEditingPack(pack)}
                  >
                    {t("admin.editPack")}
                  </button>
                  <button
                    className="danger-link"
                    disabled={busy === `delete:${pack.id}`}
                    onClick={() => void removePack(pack.id)}
                  >
                    {t("admin.delete")}
                  </button>
                </div>
              </article>
            ))}
            <form
              className="card form-stack"
              key={editingPack?.id || "new-pack"}
              onSubmit={(event) => {
                event.preventDefault();
                void savePack(event.currentTarget);
              }}
            >
              <p className="eyebrow">
                {editingPack ? t("admin.editPack") : t("admin.newEdit")}
              </p>
              <label>
                {t("admin.packId")}
                <input
                  name="id"
                  required
                  placeholder="credits-250k"
                  defaultValue={editingPack?.id || ""}
                  pattern="[a-z0-9][a-z0-9-]{1,63}"
                />
              </label>
              <label>
                {t("admin.packName")}
                <input
                  name="name"
                  required
                  placeholder="250K AI credits"
                  defaultValue={editingPack?.name || ""}
                />
              </label>
              <label>
                {t("admin.packCredits")}
                <input
                  name="tokenCredits"
                  type="number"
                  min="1"
                  required
                  defaultValue={editingPack?.tokenCredits || ""}
                />
              </label>
              <label>
                {t("admin.stripePrice")}{" "}
                <span className="optional">{t("admin.secretNotShown")}</span>
                <input
                  name="priceId"
                  autoComplete="off"
                  placeholder="price_…"
                />
              </label>
              <button className="primary" disabled={busy === "pack"}>
                {busy === "pack" ? t("admin.saving") : t("admin.savePack")}
              </button>
            </form>
          </div>
          </> : null}
          {cmsAiEnabled && <>
          <section className="card temporary-flag-card">
            <p className="eyebrow">{t("admin.temporaryFlags")}</p>
            <h2>{t("admin.billingTestTitle")}</h2>
            <p className="muted">{t("admin.billingTestHelp")}</p>
            <div className="temporary-flag-warning" role="note">
              <strong>{t("admin.billingTestWarningTitle")}</strong>
              <span>{t("admin.billingTestWarning")}</span>
            </div>
            <label className="switch-row">
              <span>
                <b>{t("admin.billingTestToggle")}</b>
                <small>{billingTestMode ? t("admin.billingTestOn") : t("admin.billingTestOff")}</small>
              </span>
              <input
                type="checkbox"
                checked={billingTestMode}
                onChange={(event) => setBillingTestMode(event.target.checked)}
              />
            </label>
            <div className="form-actions">
              <button className="primary" type="button" disabled={billingTestSaving} onClick={() => void saveBillingTestMode()}>
                {billingTestSaving ? t("admin.saving") : t("admin.saveFeatureFlag")}
              </button>
            </div>
          </section>
          <section className="card temporary-flag-card workflow-flags-card">
            <p className="eyebrow">{t("admin.workflowFlagsEyebrow")}</p>
            <h2>{t("admin.workflowFlagsTitle")}</h2>
            <p className="muted">{t("admin.workflowFlagsHelp")}</p>
            <label className="switch-row">
              <span>
                <b>{t("admin.assistantFlag")}</b>
                <small>{assistantEnabled ? t("admin.workflowFlagOn") : t("admin.workflowFlagOff")}</small>
              </span>
              <input type="checkbox" checked={assistantEnabled} onChange={(event) => setAssistantEnabled(event.target.checked)} />
            </label>
            <label className="switch-row">
              <span>
                <b>{t("admin.blogWizardFlag")}</b>
                <small>{blogWizardEnabled ? t("admin.workflowFlagOn") : t("admin.workflowFlagOff")}</small>
              </span>
              <input type="checkbox" checked={blogWizardEnabled} onChange={(event) => setBlogWizardEnabled(event.target.checked)} />
            </label>
            <div className="form-actions">
              <button className="primary" type="button" disabled={workflowSaving} onClick={() => void saveWorkflowFlags()}>
                {workflowSaving ? t("admin.saving") : t("admin.saveWorkflowFlags")}
              </button>
            </div>
          </section>
          </>}
        </section>
      ) : (
        <section className="card">
          <h2>{t("admin.restrictedTitle")}</h2>
          <p className="muted">{t("admin.restrictedHelp")}</p>
        </section>
      )}
      {pendingDeletePack && (
        <ConfirmModal
          title={t("admin.confirmDelete")}
          description={`${t("admin.confirmDeleteDescription")} ${pendingDeletePack}`}
          confirmLabel={t("admin.delete")}
          busy={busy === `delete:${pendingDeletePack}`}
          onClose={() => setPendingDeletePack(null)}
          onConfirm={() => void confirmRemovePack()}
        />
      )}
      {showBrandAi && selectedBrandFile && (
        <BrandAiModal
          file={selectedBrandFile}
          current={brandContent}
          busy={brandAiBusy}
          onClose={() => setShowBrandAi(false)}
          onGenerate={(prompt) => void generateBrandFile(prompt)}
        />
      )}
      {selectedReference && (
        <ReferenceMediaModal
          media={selectedReference}
          busy={referenceBusy}
          onClose={() => setSelectedReference(null)}
          onSave={(alt) => void saveReference(selectedReference, alt)}
          onDelete={() => {
            const media = selectedReference;
            setSelectedReference(null);
            void deleteReference(media);
          }}
        />
      )}
      {pendingDeleteUser && (
        <ConfirmModal
          title={t("admin.deleteUser")}
          description={`${t("admin.deleteUserDescription")} ${pendingDeleteUser.email || ""}`}
          confirmLabel={t("admin.delete")}
          busy={userBusy}
          onClose={() => setPendingDeleteUser(null)}
          onConfirm={() => void deleteUser()}
        />
      )}
      {showCreateSite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !newSiteSaving) setShowCreateSite(false);
          }}
        >
          <section
            className="modal-card compact-modal site-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-site-modal-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">{t("admin.workspaceScope")}</p>
                <h2 id="create-site-modal-title">{t("admin.addSite")}</h2>
                <p className="muted">{t("admin.addSiteHelp")}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowCreateSite(false)}
                disabled={newSiteSaving}
                aria-label={t("editor.close")}
              >
                ×
              </button>
            </div>
            <form className="form-stack" onSubmit={(event) => void createSite(event)}>
              <label className="modal-field">
                {t("admin.siteHandle")}
                <input
                  required
                  autoFocus
                  value={newSiteForm.handle}
                  onChange={(event) => setNewSiteForm({ ...newSiteForm, handle: event.target.value })}
                  placeholder="cliente-nuevo"
                  pattern="[a-z][a-z0-9-]{1,46}[a-z0-9]"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="optional">{t("admin.siteHandleHelp")}</span>
              </label>
              <label className="modal-field">
                {t("admin.siteName")}
                <input
                  value={newSiteForm.name}
                  onChange={(event) => setNewSiteForm({ ...newSiteForm, name: event.target.value })}
                  placeholder="Cliente Nuevo"
                />
              </label>
              <label className="modal-field">
                {t("admin.siteDomain")}
                <input
                  required
                  type="url"
                  value={newSiteForm.domain}
                  onChange={(event) => setNewSiteForm({ ...newSiteForm, domain: event.target.value })}
                  placeholder="https://cliente-nuevo.com"
                />
              </label>
              <label className="modal-field">
                {t("admin.siteAuthors")}
                <input
                  value={newSiteForm.authors}
                  onChange={(event) => setNewSiteForm({ ...newSiteForm, authors: event.target.value })}
                  placeholder={t("admin.siteAuthorsPlaceholder")}
                />
              </label>
              <label className="modal-field">
                {t("admin.rebuildWebhook")}
                <input
                  value={newSiteForm.rebuildWebhookUrl}
                  onChange={(event) => setNewSiteForm({ ...newSiteForm, rebuildWebhookUrl: event.target.value })}
                  placeholder="https://…"
                />
              </label>
              <label className="modal-field">
                {t("admin.coolifyToken")}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newSiteForm.coolifyApiToken}
                  onChange={(event) => setNewSiteForm({ ...newSiteForm, coolifyApiToken: event.target.value })}
                  placeholder={t("admin.coolifyTokenPlaceholder")}
                />
              </label>
              <label className="switch-row">
                <span>
                  <b>{t("admin.requireHumanApproval")}</b>
                  <small>{t("admin.requireHumanApprovalHelp")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={newSiteForm.requiresHumanApproval}
                  onChange={(event) => setNewSiteForm({ ...newSiteForm, requiresHumanApproval: event.target.checked })}
                />
              </label>
              <div className="form-actions">
                <button className="ghost" type="button" onClick={() => setShowCreateSite(false)} disabled={newSiteSaving}>
                  {t("editor.close")}
                </button>
                <button className="primary" type="submit" disabled={newSiteSaving}>
                  {newSiteSaving ? t("admin.saving") : t("admin.createSite")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  back = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  back?: boolean;
}) {
  return (
    <div className="title-block">
      {back && <BackButton />}
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="muted">{description}</p>
    </div>
  );
}
function BackButton() {
  const nav = useNavigate();
  const { t } = useI18n();
  return <button type="button" className="back-link" onClick={() => nav(-1)}>← {t("common.back")}</button>;
}
function EmptyState({
  title,
  action,
  onClick,
}: {
  title: string;
  action: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="empty-state">
      <span>✦</span>
      <h2>{title}</h2>
      <p>{t("home.description")}</p>
      <button className="primary" onClick={onClick}>
        {action}
      </button>
    </section>
  );
}
function Loading() {
  const { t } = useI18n();
  return (
    <main className="page">
      <div className="loading">{t("common.loading")}</div>
    </main>
  );
}

export default App;
