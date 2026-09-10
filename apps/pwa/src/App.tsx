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
import { getInitialLanguage, Language, translate } from "./i18n";
import type { Author, MediaItem, Post, Session } from "./types";

type Draft = Partial<Post> & { title: string; slug?: string };
type AppState = {
  session: Session;
  site: string;
  sites: string[];
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
const roleLabel = (role: string | undefined, t: (key: string, fallback?: string) => string) => {
  const value = String(role || "client").trim().toLowerCase();
  return t(`role.${value}`, value.replace(/_/g, " "));
};
const uiStatus = (status?: string) => {
  if (status === "pending_schedule") return "scheduled";
  if (status === "review" || status === "changes_requested") return "draft";
  return status || "draft";
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
const fileAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

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
  return (
    <>
      <img className="brand-icon" src="/app/icon.png" alt="" />
      <span>Escarlet CMS</span>
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
      setSession(await api.session());
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
        <div className="splash">
          <div className="brand"><AppBrand /></div>
          <p>{t("app.loading")}</p>
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
                <Route path="/chat" element={<Chat />} />
                <Route path="/manual/:slug?" element={<ManualPost />} />
                <Route path="/preview/:slug" element={<Preview />} />
                <Route path="/schedule/:slug" element={<Schedule />} />
                <Route path="/publish/:slug" element={<PublishSocial />} />
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
  const [error, setError] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.loginWithToken(token.trim());
      await onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.signInError"));
    } finally {
      setSubmitting(false);
    }
  };
  const sendMagic = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMagicSent(false);
    setSubmitting(true);
    try {
      await api.requestMagicLink(email.trim());
      setMagicSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.magicError"));
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
          <button className="primary" disabled={submitting}>
            {submitting ? "…" : t("login.magic")}
          </button>
        </form>
        {magicSent && <p className="success">{t("login.sent")}</p>}
        <div className="magic-note">{t("login.magicNote")}</div>
        <details>
          <summary>{t("login.tokenAccess")}</summary>
          <form onSubmit={submit}>
            <label>
              {t("login.token")}
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("login.tokenPlaceholder")}
                autoComplete="off"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={submitting}>
              {submitting ? "…" : t("login.enter")}
            </button>
          </form>
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
            <p className="muted">{t("onboarding.tourHelp")}</p>
            <div className="onboarding-tour-list">
              <span>✦<b>{t("onboarding.tourAssistant")}</b></span>
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
  const { session, site, sites, setSite } = useApp();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const links = [
    { to: "/", label: t("nav.home"), icon: "⌂" },
    { to: "/chat", label: t("nav.assistant"), icon: "✦" },
    { to: "/posts", label: t("nav.posts"), icon: "▤" },
    { to: "/calendar", label: t("nav.calendar"), icon: "□" },
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
        <button className="new-chat" onClick={() => nav("/chat")}>
          {t("nav.newChat")}
        </button>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className="nav-link"
            >
              <i>{link.icon}</i>
              {link.label}
            </NavLink>
          ))}
          {isAdmin(session.role) && (
            <NavLink to="/admin" className="nav-link">
              <i>⚙</i>
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
          <button
            className="icon-button"
            onClick={() => setOpen(true)}
            aria-label={t("nav.open")}
          >
            ☰
          </button>
          <NavLink to="/" className="brand">
            <AppBrand />
          </NavLink>
          <NavLink
            className="icon-button"
            to="/settings"
            aria-label={t("nav.settings")}
          >
            ◌
          </NavLink>
        </header>
        <Outlet />
      </section>
    </div>
  );
}

function CreditIndicator({ site }: { site: string }) {
  const { t, language } = useI18n();
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    let active = true;
    api.billingSnapshot(site).then((data) => active && setSnapshot(data)).catch(() => active && setSnapshot(null));
    return () => { active = false; };
  }, [site]);
  const available = Number(snapshot?.ai?.available);
  if (!snapshot || !Number.isFinite(available)) return null;
  return (
    <NavLink className="credit-indicator" to="/billing" title={t("billing.available")}>
      <span>✦</span>
      <span>
        <b>{available.toLocaleString(language === "en" ? "en-GB" : "es-ES")}</b>
        <small>{t("billing.creditsLeft")}</small>
      </span>
    </NavLink>
  );
}

function Home() {
  const nav = useNavigate();
  const { session, site } = useApp();
  const { t } = useI18n();
  return (
    <main className="page home">
      <div className="home-intro">
        <p className="eyebrow">{site}</p>
        <h1>{t("home.title")}</h1>
        <p className="muted">{t("home.description")}</p>
      </div>
      <div className="choice-grid">
        <button className="choice-card ai" onClick={() => nav("/chat")}>
          <span>✦</span>
          <strong>{t("home.ai.title")}</strong>
          <small>{t("home.ai.description")}</small>
          <b>{t("home.ai.action")}</b>
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
          <button onClick={() => nav("/calendar")}>{t("home.calendar")}</button>
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

function Chat() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [messages, setMessages] = useState<
    Array<{ role: "assistant" | "user"; text: string }>
  >([{ role: "assistant", text: t("chat.greeting") }]);
  const [value, setValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [lastBrief, setLastBrief] = useState("");
  const [batchCount, setBatchCount] = useState("3");
  const { site } = useApp();
  const { showToast } = useToast();
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
    try {
      await api.aiChat(
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
      const title = lastBrief.slice(0, 72);
      const result = await api.createDraft({
        site,
        title,
        slug: slugify(title),
        contentSource: "client",
      });
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
  const createBatch = async () => {
    if (!lastBrief) return;
    setCreating(true);
    try {
      const count = Number(batchCount) || 3;
      const result = await api.aiGenerate({
        site,
        operation: "title",
        prompt: `Propón ${count} títulos independientes para una serie de posts sobre esta idea. Devuelve solo un título por línea, sin numeración: ${lastBrief}`,
        model: localStorage.getItem("escarlet_model") || undefined,
      });
      const titles = (result.content || "")
        .split(/\n+/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter(Boolean)
        .slice(0, count);
      const fallback = Array.from({ length: count }, (_, index) => `${lastBrief.slice(0, 58)} · ${index + 1}`);
      const created = await Promise.all((titles.length ? titles : fallback).map((title) => api.createDraft({ site, title, slug: slugify(title), contentSource: "client" })));
      showToast(`${created.length} ${t("chat.batchCreated")}`);
      nav("/posts");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setCreating(false);
    }
  };
  return (
    <main className="chat-page">
      <div className="chat-top">
        <div>
          <p className="eyebrow">{t("chat.eyebrow")}</p>
          <h1>{t("chat.title")}</h1>
        </div>
        <button
          className="ghost"
          onClick={() => {
            setLastBrief("");
            setMessages([{ role: "assistant", text: t("chat.reset") }]);
          }}
        >
          {t("chat.clear")}
        </button>
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
      </div>
      {lastBrief && (
        <div className="chat-actions">
          <button className="secondary draft-from-chat" disabled={creating} onClick={createDraft}>
            {t("chat.convert")}
          </button>
          <div className="batch-create">
            <span>{t("chat.batchLabel")}</span>
            <ChoicePills
              value={batchCount}
              ariaLabel={t("chat.batchLabel")}
              onChange={setBatchCount}
              options={["2", "3", "5"].map((value) => ({ value, label: value }))}
            />
            <button className="ghost" disabled={creating} onClick={() => void createBatch()}>
              {t("chat.batchAction")}
            </button>
          </div>
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
  ) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"content" | "description" | "both">("both");
  const [prompt, setPrompt] = useState("");
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
        if (e.target === e.currentTarget) onClose();
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
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t("editor.imagePromptPlaceholder")}
            />
          </label>
        )}
        <div className="form-actions">
          <button className="ghost" type="button" onClick={onClose}>
            {t("editor.close")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={
              busy ||
              ((mode === "description" || mode === "both") && !prompt.trim())
            }
            onClick={() => onGenerate(mode, prompt)}
          >
            {busy ? t("editor.saving") : t("editor.generate")}
          </button>
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
    "title" | "summary" | "body" | "meta" | "image" | null
  >(null);
  const [error, setError] = useState("");
  const [seoMessage, setSeoMessage] = useState("");
  const [seoValid, setSeoValid] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [slugEdited, setSlugEdited] = useState(Boolean(editSlug));
  const [draftRecovered, setDraftRecovered] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.brand(site).catch(() => ({})),
      api.authors(site).catch(() => ({ authors: [] })),
    ])
      .then(([brand, authorData]) => {
        if (!active) return;
        const source = [...(brand.authors || []), ...(authorData.authors || [])];
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
    if (draft.title || draft.excerptEs || draft.bodyHtml !== "<p></p>")
      localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);
  const update = (key: keyof Draft, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateTitle = (title: string) =>
    setDraft((current) => ({
      ...current,
      title,
      slug: slugEdited ? current.slug : slugify(title),
    }));
  const generate = async (operation: "title" | "summary" | "body" | "meta") => {
    setError("");
    setGenerating(operation);
    try {
      const prompt =
        operation === "meta"
          ? `Escribe una meta descripción SEO de 70 a 180 caracteres para este post. Título: ${draft.title}. Contenido: ${draft.bodyHtml}`
          : operation === "summary"
            ? `Escribe un resumen de una sola frase, claro y atractivo, para el listado del blog. Título: ${draft.title}. Contenido: ${draft.bodyHtml}`
            : draft.title ||
              draft.excerptEs ||
              "Propón contenido para este post";
      const result = await api.aiGenerate({
        site,
        operation: operation === "meta" ? "meta-description" : operation,
        prompt,
        post: draft,
        model: localStorage.getItem("escarlet_model") || undefined,
      });
      if (operation === "title") updateTitle(result.content || "");
      else if (operation === "summary")
        update("excerptEs", (result.content || "").slice(0, 220));
      else if (operation === "body")
        update(
          "bodyHtml",
          `<p>${(result.content || "").replace(/\n+/g, "</p><p>")}</p>`,
        );
      else
        update("metaDescription", {
          ...(draft.metaDescription || {}),
          es: (result.content || "").slice(0, 180),
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setGenerating(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setImageBusy(false);
    }
  };
  const generateImage = async (
    mode: "content" | "description" | "both",
    description: string,
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
      const result = await api.generateImage({
        site,
        prompt,
        slug: draft.slug || slugify(draft.title),
        title: draft.title,
        alt: draft.imageAlt || draft.title,
      });
      update("imageUrl", result.media.url || result.media.path || "");
      update(
        "imageThumbUrl",
        result.media.thumbUrl || result.media.thumbPath || "",
      );
      setShowImageModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
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
      if (editSlug)
        saved = await api.updatePost({
          ...draft,
          site,
          originalSlug: editSlug,
          slug,
          direct: true,
          publishAt: nextPublishAt,
          status: editSlug && draft.status === "published" ? "draft" : draft.status,
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
        title={
          editSlug
            ? `${t("editor.title")} · ${draft.title || t("common.loading")}`
            : t("editor.title")
        }
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
          <button
            type="button"
            className="inline-ai"
            onClick={() => void generate("title")}
            disabled={Boolean(generating)}
          >
            {generating === "title" ? "…" : t("editor.suggestTitle")}
          </button>
          <input
            required
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
          <button
            type="button"
            className="inline-ai"
            onClick={() => void generate("summary")}
            disabled={Boolean(generating)}
          >
            {generating === "summary" ? "…" : t("editor.generateExcerpt")}
          </button>
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
                    {author.avatarUrl ? <img src={author.avatarUrl} alt="" /> : <span>{author.name.slice(0, 1).toUpperCase()}</span>}
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
          <button
            type="button"
            className="inline-ai"
            onClick={() => void generate("body")}
            disabled={Boolean(generating)}
          >
            {generating === "body" ? "…" : t("editor.writeWithAi")}
          </button>
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
              <button
                type="button"
                className="secondary"
                onClick={() => setShowImageModal(true)}
                disabled={imageBusy}
              >
                {t("editor.generateImage")}
              </button>
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
          <button
            type="button"
            className="inline-ai"
            onClick={() => void generate("meta")}
            disabled={Boolean(generating)}
          >
            {generating === "meta" ? "…" : t("editor.generateMeta")}
          </button>
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
          onGenerate={(mode, prompt) => void generateImage(mode, prompt)}
          busy={imageBusy}
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
      <div className="sticky-actions">
        <button
          className="ghost"
          onClick={() => nav(`/manual/${encodeURIComponent(post.slug)}`)}
        >
          {t("preview.edit")}
        </button>
        <button
          className="secondary"
          onClick={() => nav(`/social-pack/${encodeURIComponent(post.slug)}`)}
        >
          {t("preview.socialPack")}
        </button>
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
  const [socialPack, setSocialPack] = useState<Record<string, string> | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [articleUrl, setArticleUrl] = useState("");
  useEffect(() => {
    Promise.all([api.post(slug, site), api.onboarding(site).catch(() => ({}))])
      .then(([r, onboarding]) => {
        setPost(r.post);
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
      });
      const generated = Object.fromEntries(
        Object.entries(result.socialPack || {}).map(([key, value]) => [
          key,
          typeof value === "string" && articleUrl && !value.includes(articleUrl)
            ? `${value}\n\n${articleUrl}`
            : value,
        ]),
      );
      const saved = await api.updatePost({
        ...post,
        site,
        originalSlug: post.slug,
        slug: post.slug,
        direct: true,
        keepPublished: post.status === "published",
        socialPack: generated,
      });
      setPost(saved.post);
      setSocialPack(generated);
      setMessage(result.content || t("publish.ready"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("common.error"));
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
      showToast(result.message || t("publish.published"));
      setTimeout(() => nav("/posts"), 900);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("common.error"));
      showToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  };
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
          <button className="secondary" disabled={busy} onClick={generatePack}>
            {busy ? t("publish.preparing") : t("publish.generate")}
          </button>
          {socialPack && (
            <div className="social-output">
              {Object.entries(socialPack).map(([channel, text]) => (
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
          {socialPack && (
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
  const [post, setPost] = useState<Post | null>(null);
  const [socialPack, setSocialPack] = useState<Record<string, any>>({});
  const [articleUrl, setArticleUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  useEffect(() => {
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
  }, [slug, site, t]);
  const withCanonical = (value: string) =>
    value && articleUrl && !value.includes(articleUrl)
      ? `${value}\n\n${articleUrl}`
      : value;
  const generatePack = async () => {
    if (!post) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.aiGenerate({
        site,
        operation: "social-pack",
        prompt: `Genera un social pack para ${post.title}. Incluye este enlace canónico en los textos que admitan enlaces: ${articleUrl}`,
        post: { ...post, articleUrl },
      });
      const generated = Object.fromEntries(
        Object.entries(result.socialPack || {}).map(([key, value]) => [
          key,
          typeof value === "string" ? withCanonical(value) : value,
        ]),
      );
      const saved = await api.updatePost({
        ...post,
        site,
        originalSlug: post.slug,
        slug: post.slug,
        direct: true,
        keepPublished: post.status === "published",
        socialPack: generated,
      });
      setPost(saved.post);
      setSocialPack(generated);
      setMessage(t("publish.ready"));
      showToast(t("publish.ready"));
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
  return (
    <main className="page social-pack-page">
      <PageTitle
        eyebrow={t("social.eyebrow")}
        title={t("social.title")}
        description={t("social.description")}
        back
      />
      {post && (
        <div className="social-pack-toolbar">
          <div>
            <p className="eyebrow">{t("social.articleUrl")}</p>
            <a
              className="article-url"
              href={articleUrl}
              target="_blank"
              rel="noreferrer"
            >
              {articleUrl}
            </a>
          </div>
          <div className="form-actions">
            <button className="ghost" onClick={() => void copy(articleUrl)}>
              {t("social.copyUrl")}
            </button>
            <button
              className="secondary"
              onClick={download}
              disabled={!Object.keys(socialPack).length}
            >
              {t("social.download")}
            </button>
            <button
              className="primary"
              onClick={() => void generatePack()}
              disabled={busy}
            >
              {busy
                ? t("publish.preparing")
                : Object.keys(socialPack).length
                  ? t("social.regenerate")
                  : t("social.generate")}
            </button>
          </div>
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
                {Array.isArray(socialPack.instagramSlides) &&
                socialPack.instagramSlides.length > 0 ? (
                  <div className="instagram-carousel">
                    {socialPack.instagramSlides.map(
                      (slide: any, index: number) => {
                        const image =
                          slide?.imageUrl || slide?.url || slide?.image || "";
                        return (
                          <figure key={slide?.id || `${image}-${index}`}>
                            {image ? (
                              <img
                                src={image}
                                alt={
                                  slide?.alt ||
                                  slide?.headline ||
                                  `${t("social.slide")} ${index + 1}`
                                }
                              />
                            ) : (
                              <div className="carousel-placeholder">
                                {index + 1}
                              </div>
                            )}
                            {(slide?.headline || slide?.text) && (
                              <figcaption>
                                {slide.headline || slide.text}
                              </figcaption>
                            )}
                          </figure>
                        );
                      },
                    )}
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
      {Object.keys(socialPack).length ? (
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
                  <button
                    className="secondary"
                    onClick={() => setShowTeleprompter(true)}
                  >
                    {t("social.record")}
                  </button>
                </div>
                <p>{socialPack.videoScript}</p>
              </article>
            )}
        </div>
      ) : (
        <section className="empty-state">
          <span>✦</span>
          <h2>{t("social.empty")}</h2>
          <p>{t("social.description")}</p>
          <button
            className="primary"
            onClick={() => void generatePack()}
            disabled={busy}
          >
            {busy ? t("publish.preparing") : t("social.generate")}
          </button>
        </section>
      )}
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
  const [speed, setSpeed] = useState(1);
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
          <div className="teleprompter-speed">
            <ChoicePills
              value={String(speed)}
              ariaLabel={t("social.speed")}
              onChange={(value) => setSpeed(Number(value))}
              options={["0.5", "1", "1.5", "2"].map((value) => ({
                value,
                label: `${value}×`,
              }))}
            />
          </div>
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
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
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
                    onClick={() => setStatusFilter(filter)}
                  >
                    {t(`posts.filter.${filter}`)}
                  </button>
                ),
              )}
            </div>
          </div>
          {visiblePosts.length ? (
            <div className="post-list">
              {visiblePosts.map((post) => (
                <PostRow key={post.slug} post={post} />
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
function PostRow({ post }: { post: Post }) {
  const nav = useNavigate();
  const { t, language } = useI18n();
  const [imageError, setImageError] = useState(false);
  const statusKey = uiStatus(post.status);
  const status = t(`status.${statusKey}`, statusKey);
  const imageSrc = post.imageThumbUrl || post.imageUrl;
  return (
    <div className="post-row">
      <button
        className="post-row-main"
        onClick={() => nav(`/preview/${encodeURIComponent(post.slug)}`)}
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
      <button
        className="post-pack-button"
        type="button"
        onClick={() => nav(`/social-pack/${encodeURIComponent(post.slug)}`)}
        aria-label={t("preview.socialPack")}
        title={t("preview.socialPack")}
      >
        <MobileSocialIcon />
      </button>
    </div>
  );
}

function Calendar() {
  const { site } = useApp();
  const { t, language } = useI18n();
  const nav = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<"list" | "month">("list");
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  useEffect(() => {
    api
      .calendar(site)
      .then((r) => setPosts(r.posts || []))
      .catch((e) => setError(e.message));
  }, [site, retry]);
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
    <main className="page">
      <PageTitle
        eyebrow={t("calendar.eyebrow")}
        title={t("calendar.title")}
        description={t("calendar.description")}
        back
      />
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
      <div className="calendar-toolbar">
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
      </div>
      {scheduledPosts.length ? (view === "list" ? (
        <div className="calendar-list">
          {Object.entries(grouped).map(([date, rows]) => (
            <section key={date}>
              <h2>{readableDate(date, language)}</h2>
              {rows.map((post) => <PostRow key={post.slug} post={post} />)}
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
                    <button key={post.slug} type="button" className="calendar-day-post" onClick={() => nav(`/preview/${encodeURIComponent(post.slug)}`)} title={post.title}>{post.title}</button>
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
  const { session, site, refresh } = useApp();
  const { language, setLanguage, t } = useI18n();
  const { showToast } = useToast();
  const [model, setModel] = useState(
    localStorage.getItem("escarlet_model") || "auto",
  );
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
        <label>
          {t("settings.model")}
          <ChoicePills
            value={model}
            ariaLabel={t("settings.model")}
            onChange={setModel}
            options={[
              { value: "auto", label: t("settings.modelAuto") },
              { value: "gpt", label: t("settings.modelGpt") },
              { value: "gemini", label: t("settings.modelGemini") },
              { value: "grok", label: t("settings.modelGrok") },
            ]}
          />
        </label>
        <p className="tiny">{t("settings.modelHelp")}</p>
        <button className="secondary" onClick={save}>
          {t("settings.save")}
        </button>
        {message && <p className="success">{message}</p>}
      </section>
      <section className="card settings-card">
        <p className="eyebrow">{t("settings.workspace")}</p>
        <h2>{site}</h2>
        <p className="muted">
          {t("settings.role")}: {roleLabel(session.role, t)}
        </p>
        <NavLink className="text-link" to="/billing">
          {t("settings.credits")}
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
  const { site } = useApp();
  const { t, language } = useI18n();
  const { showToast } = useToast();
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    api
      .billingSnapshot(site)
      .then(setSnapshot)
      .catch(() => setMessage(t("billing.unavailable")));
  }, [site, t]);
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
function Admin() {
  const { site, session } = useApp();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [sites, setSites] = useState<string[]>([]);
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
  const [siteForm, setSiteForm] = useState({ name: "", domain: "", rebuildWebhookUrl: "", blogEnabled: true, reviewMode: "direct" });
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
  const [busy, setBusy] = useState("");
  const report = (value: string, kind: "success" | "error" = "success") => {
    setMessageKind(kind);
    setMessage(value);
    showToast(value, kind);
  };
  const loadAiBilling = async () => {
    try {
      const [providerData, packData, billingData, featureFlagData] = await Promise.all([
        api.aiProviders(),
        api.creditPacks(),
        api.billing(site).catch(() => ({ models: [] })),
        api.featureFlags(),
      ]);
      setProviders(providerData.providers);
      setPacks(packData.packs);
      setBillingTestMode(Boolean(featureFlagData.flags?.creditCheckoutWithoutStripe));
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
      .users(site)
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
          blogEnabled: data.config?.blogEnabled !== false,
          reviewMode: String(data.config?.reviewMode || "direct"),
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
        await api.updateUser({ id: userForm.id, role: userForm.role, sites: userForm.sites, allowPublishingAs: userForm.allowPublishingAs });
      } else {
        const result = await api.registerUser({ email: userForm.email, role: userForm.role, sites: userForm.sites, invite: true });
        if (result.invite?.link) {
          await navigator.clipboard?.writeText(result.invite.link).catch(() => {});
          invitationMessage = `${t("admin.magicLinkReady")} ${result.invite.link}`;
        } else if (result.invite?.transport) {
          invitationMessage = t("admin.magicLinkSent");
        }
      }
      const data = await api.users(site);
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
      const result = await api.saveSiteConfig(site, { ...siteForm, reviewMode: "direct", requiresPublishConfirmation: false });
      setSiteConfig(result.config);
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
    <main className="page admin-page">
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
      <div className="admin-grid">
        <section className="card">
          <h2>{t("admin.sites")}</h2>
          {sites.length ? (
            <ul>
              {sites.map((handle) => (
                <li key={handle}>● {handle}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("common.loading")}</p>
          )}
        </section>
        <section className="card">
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
                <button
                  className="ghost"
                  type="button"
                  disabled={brandSaving || brandAiBusy}
                  onClick={() => setShowBrandAi(true)}
                >
                  {t("admin.brandAiAction")}
                </button>
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
        <section className="card">
          <div className="section-title">
            <h2>{t("admin.users")}</h2>
            <button
              className="secondary"
              type="button"
              onClick={() => setUserForm({ email: "", role: "client", sites: [site], allowPublishingAs: false })}
            >
              {t("admin.addUser")}
            </button>
          </div>
          {teamUnavailable ? (
            <p className="muted">{t("admin.usersUnavailable")}</p>
          ) : users.length ? (
            <ul className="user-list">
              {users.map((user) => (
                <li key={user.id || user.email}>
                  <div>
                    <strong>{user.email || user.name || t("admin.user")}</strong>
                    <span>{roleLabel(user.role, t)} · {(user.sites || [user.site]).filter(Boolean).join(", ")}{user.allowPublishingAs ? " · ✦ autor" : ""}</span>
                  </div>
                  <div className="user-actions">
                    <button className="chip" type="button" onClick={() => setUserForm({ id: user.id, email: user.email || "", role: user.role || "client", sites: user.sites || [user.site || site], allowPublishingAs: Boolean(user.allowPublishingAs) })}>{t("admin.editUser")}</button>
                    <button className="chip" type="button" disabled={userBusy} onClick={() => user.hasLoginToken ? void revokeUserToken(user) : void issueUserToken(user)}>{user.hasLoginToken ? t("admin.revokeToken") : t("admin.issueToken")}</button>
                    <button className="chip" type="button" disabled={userBusy} onClick={() => void sendUserMagicLink(user)}>{t("admin.magicLink")}</button>
                    <button className="danger-link" type="button" disabled={userBusy} onClick={() => setPendingDeleteUser(user)}>{t("admin.delete")}</button>
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
                <input type="email" required disabled={Boolean(userForm.id)} value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
              </label>
              <label>
                {t("admin.userRole")}
                <ChoicePills
                  value={userForm.role}
                  ariaLabel={t("admin.userRole")}
                  onChange={(value) => setUserForm({ ...userForm, role: value })}
                  options={[
                    { value: "client", label: roleLabel("client", t) },
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
        <section className="card">
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
              <label className="checkbox-label">
                <input type="checkbox" checked={siteForm.blogEnabled} onChange={(event) => setSiteForm({ ...siteForm, blogEnabled: event.target.checked })} />
                {t("admin.blogEnabled")}
              </label>
              <div className="form-actions">
                <button className="ghost" type="button" disabled={siteSaving} onClick={() => void testSite()}>{t("admin.testRebuild")}</button>
                <button className="primary" disabled={siteSaving}>{siteSaving ? t("admin.saving") : t("admin.save")}</button>
              </div>
              {session.role === "admin" && (
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
          <div className="section-title">
            <div>
              <p className="eyebrow">{t("admin.aiBilling")}</p>
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
