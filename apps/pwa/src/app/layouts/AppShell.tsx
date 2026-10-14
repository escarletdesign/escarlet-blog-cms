import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button, IconButton, useDialogFocus } from "../../ui";

export type AppShellNavItem = { to: string; label: string; icon: string };

type AppShellProps = {
  primaryLinks: AppShellNavItem[];
  managementLinks: AppShellNavItem[];
  activeBrand: string;
  displayBrand: string;
  brandScoped: boolean;
  brandSelector?: ReactNode;
  brandLogo: ReactNode;
  mobileBrandLogo: ReactNode;
  creditIndicator?: ReactNode;
  renderAssistantContent?: (onNavigate: () => void) => ReactNode;
  userAvatar: ReactNode;
  userName: string;
  userRoleLabel: string;
  t: (key: string, fallback?: string) => string;
};

const primaryRouteGroups: Record<string, string[]> = {
  "/apps": ["/apps"],
  "/content": ["/content", "/campaigns"],
  "/publication": ["/publication"],
  "/admin": ["/admin", "/brand", "/admin/connections", "/admin/team", "/admin/billing"],
};

function isPrimaryRouteActive(pathname: string, route: string) {
  const matches = primaryRouteGroups[route] || [route];
  return matches.some((base) => base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(`${base}/`));
}

export function AppShell({
  primaryLinks,
  managementLinks,
  activeBrand,
  displayBrand,
  brandScoped,
  brandSelector,
  brandLogo,
  mobileBrandLogo,
  creditIndicator,
  renderAssistantContent,
  userAvatar,
  userName,
  userRoleLabel,
  t,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const closeMenu = useCallback(() => setOpen(false), []);
  const toggleMenu = () => open ? closeMenu() : setOpen(true);

  useEffect(() => closeMenu(), [activeBrand, closeMenu, location.key]);
  useDialogFocus(open, sidebarRef, closeMenu);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const updateCompact = () => setCompact(!desktop.matches);
    const closeOnDesktop = () => { if (desktop.matches) closeMenu(); };
    updateCompact();
    desktop.addEventListener("change", updateCompact);
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      desktop.removeEventListener("change", updateCompact);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [closeMenu]);

  const mobileLinks = primaryLinks.filter((link) => link.to !== "/chat");
  const activePrimaryRoute = primaryLinks.find((link) => isPrimaryRouteActive(location.pathname, link.to))?.to;
  const isManagementRouteActive = location.pathname === "/settings" || managementLinks.some(({ to }) => isPrimaryRouteActive(location.pathname, to));
  const isMoreRouteActive = isManagementRouteActive || Boolean(activePrimaryRoute && !mobileLinks.some((link) => link.to === activePrimaryRoute));

  return (
    <div className="app-shell">
      <aside
        ref={sidebarRef}
        id="primary-navigation"
        className={`sidebar ${open ? "open" : ""}`}
        role={open ? "dialog" : "complementary"}
        aria-label={t("nav.menu", "Menú principal")}
        aria-modal={open ? true : undefined}
        aria-hidden={compact && !open}
        inert={compact && !open}
      >
        <div className="sidebar-head">
          <NavLink to="/" className="brand" onClick={closeMenu}>{brandLogo}</NavLink>
          <IconButton className="close" onClick={closeMenu} label={t("nav.close")}>×</IconButton>
        </div>
        <div className={`site-switcher ${brandSelector ? "" : "single"} ${brandScoped ? "route-scoped" : ""}`}>
          <span className="site-switcher-label">{brandScoped ? t("brand.scopedLabel", "Marca de esta vista") : t("brand.label", "Marca activa")}</span>
          {brandSelector || <strong>● {displayBrand}</strong>}
        </div>
        {creditIndicator}
        <nav className="primary-nav" aria-label={t("nav.primary", "Navegación principal")}>
          {primaryLinks.map((link) => {
            const active = link.to === activePrimaryRoute;
            return <div className="nav-group" key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) => `nav-link${isActive || active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={closeMenu}
              >
                <NavIcon kind={link.icon} />
                {link.label}
              </NavLink>
              {link.icon === "assistant" && renderAssistantContent?.(closeMenu)}
            </div>;
          })}
        </nav>
        <div className="sidebar-nav-section">
          <span className="sidebar-nav-label">{t("nav.manage", "Administrar")}</span>
          <nav aria-label={t("nav.manage", "Administrar")}>
            {managementLinks.map((link) => {
              const active = isPrimaryRouteActive(location.pathname, link.to);
              return <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => `nav-link${isActive || active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={closeMenu}
              >
                <NavIcon kind={link.icon} />
                {link.label}
              </NavLink>;
            })}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/settings" className="profile" onClick={closeMenu}>
            {userAvatar}
            <span><b>{userName}</b><small>{t("settings.role")}: {userRoleLabel}</small></span>
            <span>···</span>
          </NavLink>
        </div>
      </aside>
      <IconButton className={`backdrop ${open ? "show" : ""}`} onClick={closeMenu} label={t("nav.close")} />
      <section className="workspace">
        <a className="skip-link" href="#workspace-content">{t("nav.skipToContent", "Saltar al contenido")}</a>
        <header className="mobile-head">
          <NavLink to="/" className="brand" aria-label="Escarlet CMS" onClick={closeMenu}>{mobileBrandLogo}</NavLink>
          <div className="mobile-context">
            <span className="mobile-brand-label">{displayBrand}</span>
            {brandSelector}
          </div>
          <span className="mobile-version">{t("app.beta")}</span>
        </header>
        <div id="workspace-content" tabIndex={-1}><Outlet /></div>
        <nav className="mobile-bottom-nav" aria-label={t("nav.mobile", "Navegación principal")}>
          {mobileLinks.map((link) => {
            const active = link.to === activePrimaryRoute;
            return <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) => `mobile-bottom-link${isActive || active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <NavIcon kind={link.icon} />
              <span>{link.label}</span>
            </NavLink>;
          })}
          <Button
            variant="ghost"
            size="sm"
            className={`mobile-menu-toggle ${open ? "open" : isMoreRouteActive ? "active" : ""}`}
            onClick={toggleMenu}
            aria-label={open ? t("nav.close") : t("nav.more", "Más")}
            aria-expanded={open}
            aria-controls="primary-navigation"
            aria-current={isMoreRouteActive ? "page" : undefined}
          >
            <span className="hamburger-lines" aria-hidden="true"><i /><i /><i /></span>
            <span>{t("nav.more", "Más")}</span>
          </Button>
        </nav>
      </section>
    </div>
  );
}

export function NavIcon({ kind }: { kind: string }) {
  const common = { className: "nav-icon", viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.55, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "assistant") return <svg {...common}><path d="m10 2 1.5 5.2L17 9l-5.5 1.8L10 16l-1.5-5.2L3 9l5.5-1.8Z" /><path d="m16 13 .6 2.1L19 16l-2.4.9L16 19l-.6-2.1L13 16l2.4-.9Z" /></svg>;
  if (kind === "home") return <svg {...common}><path d="m3.5 9 6.5-5 6.5 5v6.2a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3Z" /><path d="M8 16.5v-4h4v4" /></svg>;
  if (kind === "apps") return <svg {...common}><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></svg>;
  if (kind === "review") return <svg {...common}><rect x="3" y="2.8" width="14" height="14.4" rx="2" /><path d="m6 7.5 1.2 1.2L9.6 6M11 7.5h3M6 12l1.2 1.2L9.6 10.5M11 12h3" /></svg>;
  if (kind === "plans") return <svg {...common}><rect x="4" y="4" width="11" height="12" rx="1.5" /><path d="M7 2.5h8.5A1.5 1.5 0 0 1 17 4v10.5M7 8h5M7 11h5" /></svg>;
  if (kind === "video") return <svg {...common}><rect x="3" y="5" width="14" height="10" rx="2" /><path d="m8 8 4 2-4 2Z" /></svg>;
  if (kind === "send") return <svg {...common}><path d="m3 3 14 7-14 7 3.5-7Z" /><path d="M6.5 10H17" /></svg>;
  if (kind === "calendar") return <svg {...common}><rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M6.5 2.5v4M13.5 2.5v4M3 8h14M7 11h.01M10 11h.01M13 11h.01M7 14h.01M10 14h.01" /></svg>;
  if (kind === "brands") return <svg {...common}><path d="M3 16.5V5.2a1.7 1.7 0 0 1 1.7-1.7h10.6A1.7 1.7 0 0 1 17 5.2v11.3M2 16.5h16M6 8h2M12 8h2M6 11h2M12 11h2M8 16.5v-2.7h4v2.7" /></svg>;
  if (kind === "connections") return <svg {...common}><path d="M7.4 12.6 5.7 14.3a2.8 2.8 0 0 1-4-4l2.6-2.6a2.8 2.8 0 0 1 4 0M12.6 7.4l1.7-1.7a2.8 2.8 0 0 1 4 4l-2.6 2.6a2.8 2.8 0 0 1-4 0M6.5 13.5l7-7" /></svg>;
  if (kind === "team") return <svg {...common}><circle cx="8" cy="7" r="2.5" /><path d="M3.5 16a4.5 4.5 0 0 1 9 0M14 6.2a2.1 2.1 0 0 1 0 4.1M14.2 12.3a3.8 3.8 0 0 1 2.3 3.5" /></svg>;
  if (kind === "billing") return <svg {...common}><path d="M4 15.8V5.2M4 15.8a2.2 2.2 0 0 0 2.2 2.2h9.3M4 5.2A2.2 2.2 0 0 1 6.2 3h9.3a.5.5 0 0 1 .5.5V16M7.3 7.2h5.5M7.3 10.3h4" /></svg>;
  return <svg {...common}><path d="M8.1 3.4 8.6 2h2.8l.5 1.4 1.2.7 1.4-.4 2 2-.5 1.4.7 1.2 1.4.5v2.8l-1.4.5-.7 1.2.5 1.4-2 2-1.4-.4-1.2.7-.5 1.4H8.6l-.5-1.4-1.2-.7-1.4.4-2-2 .5-1.4-.7-1.2-1.4-.5V8.3l1.4-.5.7-1.2-.5-1.4 2-2 1.4.4 1.2-.7Z" /><circle cx="10" cy="9.7" r="2.5" /></svg>;
}
