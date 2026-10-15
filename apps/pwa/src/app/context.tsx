import { createContext, useContext } from "react";
import type { BrandSummary, Session } from "../types";
import type { Language } from "../i18n";

export type WorkflowFlags = {
  cmsAiEnabled: boolean;
  assistantEnabled: boolean;
  blogWizardEnabled: boolean;
  legacyPreviewEnabled: boolean;
  legacySocialPackEnabled: boolean;
  authorInviteEnabled: boolean;
  creationUiEnabled: boolean;
  manualCreationEnabled: boolean;
};

export type AppState = {
  session: Session;
  site: string;
  sites: string[];
  contentMode: "blog" | "socialmedia";
  workflowFlags: WorkflowFlags;
  channels: Array<{ channel: string; enabled: boolean; connectionStatus?: string; provider?: string | null; connectionId?: string | null }>;
  brandCapabilities: Record<string, boolean>;
  productContext?: {
    workspace: { id: string; name?: string };
    activeBrand?: { id: string; handle?: string; name?: string; role?: string } | null;
    brands: BrandSummary[];
    channels?: Array<{ channel: string; enabled: boolean }>;
    connections: Array<Record<string, any>>;
    brandCapabilities?: Record<string, boolean>;
    usage?: Record<string, any>;
  };
  setSite: (site: string) => void;
  refresh: () => Promise<void>;
};

export type I18nState = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, fallback?: string) => string;
};

export type ToastKind = "success" | "error" | "info";
export type Toast = { id: number; message: string; kind: ToastKind };
export type ToastState = { showToast: (message: string, kind?: ToastKind) => void };

export const SessionContext = createContext<AppState | null>(null);
export const I18nContext = createContext<I18nState | null>(null);
export const ToastContext = createContext<ToastState | null>(null);

export function useApp() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("App context unavailable");
  return value;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18n context unavailable");
  return value;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("Toast context unavailable");
  return value;
}
