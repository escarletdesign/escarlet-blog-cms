import { useEffect, useState, type MouseEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, type AiConversation } from "../../api";
import { IconButton } from "../../ui";

type Props = {
  site: string;
  t: (key: string, fallback?: string) => string;
  showToast: (message: string, kind?: "success" | "error" | "info") => void;
  onNavigate?: () => void;
};

export function SidebarConversations({ site, t, showToast, onNavigate }: Props) {
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
    const onDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ site?: string }>).detail;
      if (!detail?.site || detail.site === site) void load();
    };
    const onArchived = (event: Event) => {
      const detail = (event as CustomEvent<{ site?: string }>).detail;
      if (!detail?.site || detail.site === site) void load();
    };
    window.addEventListener("escarlet:conversation-saved", onSaved);
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

  const removeConversation = async (event: MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (deleting || !window.confirm(t("chat.deleteConfirm"))) return;
    setDeleting(id);
    try {
      await api.deleteAiConversation(id, site);
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      try {
        const storageKey = `escarlet_chat_threads:${site}`;
        const local = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(local)) window.localStorage.setItem(storageKey, JSON.stringify(local.filter((thread) => thread?.id !== id)));
        if (new URLSearchParams(location.search).get("conversation") === id) window.localStorage.removeItem(`escarlet_chat_active:${site}`);
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
      {conversations.slice(0, 6).map((conversation) => <div className="sidebar-conversation-row" key={conversation.id}>
        <NavLink
          to={`/chat?conversation=${encodeURIComponent(conversation.id)}`}
          className="sidebar-conversation"
          title={conversation.title}
          onClick={onNavigate}
        >
          <span>·</span>
          <span>{conversation.title || t("chat.newConversation")}</span>
        </NavLink>
        <IconButton
          className="sidebar-conversation-delete"
          label={`${t("chat.delete")} ${conversation.title || t("chat.newConversation")}`}
          title={t("chat.delete")}
          disabled={deleting === conversation.id}
          onClick={(event) => void removeConversation(event, conversation.id)}
        >×</IconButton>
      </div>)}
    </div>
  );
}
