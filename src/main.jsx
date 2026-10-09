import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  closestCorners,
  pointerWithin,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Layers,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  List,
  Clock,
  CalendarDays,
  MessageSquare,
  Paperclip,
  Check,
  CheckSquare,
  MoreHorizontal,
  GripVertical,
  X,
  Users,
  Settings,
  LogOut,
  Shield,
  FolderOpen,
  Menu,
  ArrowLeft,
  Trash2,
  Link,
  Copy,
  Mail,
  Lock,
  CloudUpload,
  FileText,
  ExternalLink,
  LoaderCircle,
  Flag,
  SlidersHorizontal,
  Code2,
  Rocket,
  Palette,
  Briefcase,
  Archive,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  PanelLeftClose,
  Inbox,
} from "lucide-react";
import "./styles.css";
import { CardAutosave } from "./card-autosave.js";
async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body:
      options.body instanceof FormData
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Die Anfrage ist fehlgeschlagen."),
      { status: response.status },
    );
  return data;
}
const bucketIsDone = (columns, column) =>
  column.isDone ?? column.id === columns.at(-1)?.id;
const cardIsDone = (board, card) =>
  board.columns.some(
    (column) =>
      column.id === card.columnId && bucketIsDone(board.columns, column),
  );
const icons = {
  layers: Layers,
  code: Code2,
  rocket: Rocket,
  palette: Palette,
  briefcase: Briefcase,
};
const priorities = {
  urgent: { label: "Dringend", color: "red" },
  high: { label: "Hoch", color: "orange" },
  medium: { label: "Mittel", color: "blue" },
  low: { label: "Niedrig", color: "gray" },
};
const roleNames = {
  owner: "Eigentümer",
  editor: "Bearbeiten",
  viewer: "Lesen",
};
const palette = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#0ea5e9",
  "#8b5cf6",
];
const shortDate = (value) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("de-DE", {
        day: "numeric",
        month: "short",
      })
    : "";
const dateTime = (value) =>
  new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const initials = (name) =>
  (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
function Avatar({ user, size = "normal" }) {
  return (
    <span
      className={`avatar ${size}`}
      title={user?.name}
      style={{
        background: `${user?.color || "#6366f1"}18`,
        color: user?.color || "#6366f1",
      }}
    >
      {initials(user?.name)}
    </span>
  );
}
function ProjectIcon({ project }) {
  const Icon = icons[project.icon] || Layers;
  return (
    <span
      className="project-icon"
      style={{ background: `${project.color}16`, color: project.color }}
    >
      <Icon size={18} />
    </span>
  );
}
function Spinner() {
  return <LoaderCircle className="spin" size={18} />;
}
function Empty({ icon: Icon = Inbox, title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Schließen"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function FormError({ error }) {
  return error ? (
    <p className="form-error" role="alert">
      <AlertCircle size={16} />
      {error}
    </p>
  ) : null;
}
function App() {
  const [publicInfo, setPublicInfo] = useState(null),
    [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState("");
  const [projects, setProjects] = useState([]),
    [projectId, setProjectId] = useState(null),
    [boardId, setBoardId] = useState(null),
    [board, setBoard] = useState(null),
    [members, setMembers] = useState([]);
  const [view, setView] = useState("board"),
    [subview, setSubview] = useState("kanban"),
    [search, setSearch] = useState(""),
    [priorityFilter, setPriorityFilter] = useState("all"),
    [mineFilter, setMineFilter] = useState(false),
    [sideOpen, setSideOpen] = useState(false);
  const [modal, setModal] = useState(null),
    [toast, setToast] = useState(null),
    [loadError, setLoadError] = useState(""),
    [invite, setInvite] = useState(
      new URLSearchParams(location.search).get("invite"),
    );
  const [busy, setBusy] = useState(false),
    [activity, setActivity] = useState([]),
    [compact, setCompact] = useState(
      () => window.matchMedia("(max-width:850px)").matches,
    );
  useEffect(() => {
    const media = window.matchMedia("(max-width:850px)");
    const changed = (e) => setCompact(e.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const currentBoard = useRef(null),
    refreshGeneration = useRef(0),
    modalRef = useRef(null);
  useEffect(() => {
    modalRef.current = modal;
  }, [modal]);
  const notify = useCallback(
    (message, error = false) => setToast({ message, error }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const boot = useCallback(async () => {
    try {
      const info = await api("/public");
      setPublicInfo(info);
      try {
        setUser(await api("/me"));
      } catch (e) {
        if (e.status !== 401) throw e;
        setUser(null);
      }
      setFatal("");
    } catch (e) {
      setFatal(
        "Die Anwendung ist gerade nicht erreichbar. Bitte versuche es erneut.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    boot();
  }, [boot]);
  const reloadProjects = useCallback(async () => {
    const data = await api("/projects");
    setProjects(data);
    return data;
  }, []);
  useEffect(() => {
    if (!user || invite) return;
    reloadProjects()
      .then((data) => {
        if (!projectId && data.length) {
          setProjectId(data.find((p) => !p.archived)?.id || data[0].id);
        }
      })
      .catch((e) => notify(e.message, true));
  }, [user, invite, reloadProjects]);
  const project = projects.find((p) => p.id === projectId);
  useEffect(() => {
    setBoard(null);
    setMembers([]);
    if (!project) return;
    setBoardId(
      project.Boards?.find((b) => b.id === boardId)?.id ||
        project.Boards?.[0]?.id ||
        null,
    );
    api(`/projects/${project.id}/members`)
      .then(setMembers)
      .catch((e) => notify(e.message, true));
  }, [projectId, projects.length]);
  useEffect(() => {
    if (project && !project.Boards.some((b) => b.id === boardId))
      setBoardId(project.Boards[0]?.id || null);
  }, [project, boardId]);
  const refreshBoard = useCallback(
    async (silent = false) => {
      if (!boardId) return;
      const generation = ++refreshGeneration.current;
      try {
        const data = await api(`/boards/${boardId}`);
        if (
          generation !== refreshGeneration.current ||
          currentBoard.current !== boardId
        )
          return;
        setBoard(data);
        setLoadError("");
      } catch (e) {
        if (generation !== refreshGeneration.current) return;
        if (e.status === 401) {
          setUser(null);
          return;
        }
        if (!silent || e.status === 403 || e.status === 404)
          setLoadError(e.message);
      }
    },
    [boardId],
  );
  useEffect(() => {
    currentBoard.current = boardId;
    setBoard(null);
    setLoadError("");
    if (!boardId) return;
    refreshBoard();
    const timer = setInterval(() => {
      if (!document.hidden && !modalRef.current) refreshBoard(true);
    }, 5000);
    return () => {
      clearInterval(timer);
      refreshGeneration.current++;
    };
  }, [boardId, refreshBoard]);
  useEffect(() => {
    if (!boardId || subview !== "activity" || view !== "board") return;
    const load = () =>
      api(`/boards/${boardId}/activity`)
        .then(setActivity)
        .catch((e) => notify(e.message, true));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [boardId, subview, view]);
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setProjects([]);
      setProjectId(null);
      setBoardId(null);
      setBoard(null);
      await boot();
    } catch (e) {
      notify(e.message, true);
    }
  }
  function selectProject(id) {
    setProjectId(id);
    setView("board");
    setSubview("kanban");
    setSearch("");
    setPriorityFilter("all");
    setMineFilter(false);
    setSideOpen(false);
  }
  async function mutate(fn, message) {
    setBusy(true);
    try {
      await fn();
      if (message) notify(message);
      await refreshBoard();
    } catch (e) {
      notify(e.message, true);
      if (e.status === 409) await refreshBoard();
    } finally {
      setBusy(false);
    }
  }
  const canEdit = project?.myRole !== "viewer",
    isOwner = project?.myRole === "owner";
  const filtered =
    board?.cards.filter(
      (c) =>
        (!search ||
          `${c.title} ${c.description} ${c.labels.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (priorityFilter === "all" || c.priority === priorityFilter) &&
        (!mineFilter || c.assigneeId === user?.id),
    ) || [];
  async function move(cardId, columnId, index) {
    if (!board || busy) return;
    await mutate(
      () =>
        api(`/boards/${board.id}/move`, {
          method: "POST",
          body: { cardId, columnId, index, revision: board.revision },
        }),
      "Aufgabe verschoben",
    );
  }
  if (loading)
    return (
      <div className="initial-loading">
        <Brand />
        <Spinner />
        <p>Dein Arbeitsbereich wird geladen …</p>
      </div>
    );
  if (fatal)
    return (
      <div className="initial-loading">
        <Brand />
        <Empty icon={AlertCircle} title="Verbindung unterbrochen">
          {fatal}
        </Empty>
        <button className="button primary" onClick={boot}>
          Erneut versuchen
        </button>
      </div>
    );
  if (invite)
    return (
      <InviteScreen
        token={invite}
        user={user}
        publicInfo={publicInfo}
        onLogin={(u) => setUser(u)}
        onDone={async (u) => {
          setUser(u);
          setInvite(null);
          history.replaceState(null, "", "/");
          await boot();
        }}
      />
    );
  if (!user)
    return (
      <AuthScreen
        info={publicInfo}
        onSuccess={async (u) => {
          setUser(u);
          await boot();
        }}
      />
    );
  return (
    <div className="app-shell">
      {sideOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Menü schließen"
          onClick={() => setSideOpen(false)}
        />
      )}
      <aside
        inert={compact && !sideOpen ? true : undefined}
        className={`sidebar ${sideOpen ? "open" : ""}`}
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Menü schließen"
            onClick={() => setSideOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">DEIN ARBEITSBEREICH</div>
        <nav className="main-nav">
          <button
            className={view === "projects" ? "selected" : ""}
            onClick={() => {
              setView("projects");
              setSideOpen(false);
            }}
          >
            <LayoutGrid size={18} />
            Projektübersicht
          </button>
          <button
            className={view === "mine" ? "selected" : ""}
            onClick={() => {
              setView("mine");
              setSideOpen(false);
            }}
          >
            <CheckSquare size={18} />
            Meine Aufgaben
          </button>
        </nav>
        <div className="nav-section-heading">
          <span>PROJEKTE</span>
          <button
            className="icon-button"
            title="Projekt erstellen"
            aria-label="Projekt erstellen"
            onClick={() => setModal({ type: "project" })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="project-nav">
          {projects
            .filter((p) => !p.archived)
            .map((p) => (
              <button
                key={p.id}
                className={
                  p.id === projectId && view === "board" ? "selected" : ""
                }
                onClick={() => selectProject(p.id)}
              >
                <span className="project-dot" style={{ background: p.color }} />
                <span>{p.name}</span>
                {p.id === projectId && view === "board" && (
                  <ChevronRight size={14} />
                )}
              </button>
            ))}
          {projects.filter((p) => !p.archived).length === 0 && (
            <p className="nav-empty">Hier beginnt dein nächstes Projekt.</p>
          )}
        </div>
        <button
          className="new-project-link"
          onClick={() => setModal({ type: "project" })}
        >
          <Plus size={16} />
          Neues Projekt
        </button>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <div className="small-logo">
              <Layers size={16} />
            </div>
            <div>
              <strong>Zusammen geht mehr.</strong>
              <p>Ideen werden zu Ergebnissen.</p>
            </div>
          </div>
          {user.role === "admin" && (
            <button
              className={`settings-nav ${view === "admin" ? "selected" : ""}`}
              onClick={() => {
                setView("admin");
                setSideOpen(false);
              }}
            >
              <Settings size={17} />
              Administration
            </button>
          )}
          <div className="user-row">
            <Avatar user={user} />
            <div>
              <strong>{user.name}</strong>
              <span>
                {user.role === "admin" ? "Administrator" : "Mitglied"}
              </span>
            </div>
            <button
              className="icon-button"
              title="Abmelden"
              aria-label="Abmelden"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main" inert={compact && sideOpen ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Menü öffnen"
              aria-expanded={sideOpen}
              onClick={() => setSideOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Arbeitsbereich</span>
            <ChevronRight size={14} />
            <strong>
              {view === "admin"
                ? "Administration"
                : view === "projects"
                  ? "Projekte"
                  : view === "mine"
                    ? "Meine Aufgaben"
                    : project?.name || "Projekte"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="connection-status">
              <i /> Gemeinsam planen
            </span>
            <Avatar user={user} size="small" />
          </div>
        </header>
        {view === "projects" && (
          <ProjectOverview
            projects={projects}
            onSelect={selectProject}
            onCreate={() => setModal({ type: "project" })}
          />
        )}
        {view === "mine" && (
          <MyTasks
            user={user}
            projects={projects}
            onSelect={(pid, bid) => {
              selectProject(pid);
              setBoardId(bid);
              setMineFilter(true);
            }}
          />
        )}
        {view === "admin" && (
          <Admin user={user} notify={notify} onUpdate={boot} />
        )}
        {view === "board" &&
          (project ? (
            <>
              <section className="project-heading">
                <div className="project-heading-top">
                  <div className="project-title-group">
                    <ProjectIcon project={project} />
                    <span className="eyebrow">PROJEKT</span>
                    {project.archived && (
                      <span className="badge gray">Archiviert</span>
                    )}
                  </div>
                  <div className="project-heading-actions">
                    <div className="avatar-stack">
                      {members.slice(0, 4).map((m) => (
                        <Avatar key={m.id} user={m} size="small" />
                      ))}
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setModal({ type: "members" })}
                    >
                      <Users size={16} />
                      {isOwner ? "Einladen" : "Mitglieder"}
                    </button>
                    {isOwner && (
                      <button
                        className="icon-button bordered"
                        title="Projekteinstellungen"
                        aria-label="Projekteinstellungen"
                        onClick={() => setModal({ type: "project", project })}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                    )}
                  </div>
                </div>
                <h1>{project.name}</h1>
                <p className="project-description">
                  {project.description ||
                    "Alle Aufgaben im Blick. Gemeinsam den nächsten Schritt machen."}
                </p>
                <div className="project-meta">
                  <span>
                    <Layers size={14} />
                    {project.Boards.length}{" "}
                    {project.Boards.length === 1 ? "Board" : "Boards"}
                  </span>
                  <span className="meta-divider" />
                  <span>
                    <Users size={14} />
                    {members.length}{" "}
                    {members.length === 1 ? "Mitglied" : "Mitglieder"}
                  </span>
                  <span className="meta-divider" />
                  <span>
                    <CheckCircle2 size={14} />
                    {board
                      ? `${board.cards.filter((c) => cardIsDone(board, c)).length} von ${board.cards.length} Aufgaben erledigt`
                      : "Board wird geladen"}
                  </span>
                </div>
              </section>
              <div className="board-tabs">
                <div className="view-tabs">
                  <button
                    className={subview === "kanban" ? "active" : ""}
                    onClick={() => setSubview("kanban")}
                  >
                    <LayoutGrid size={16} />
                    Board
                  </button>
                  <button
                    className={subview === "list" ? "active" : ""}
                    onClick={() => setSubview("list")}
                  >
                    <List size={16} />
                    Liste
                  </button>
                  <button
                    className={subview === "activity" ? "active" : ""}
                    onClick={() => setSubview("activity")}
                  >
                    <Clock size={16} />
                    Aktivität
                  </button>
                </div>
                <div className="board-picker">
                  <select
                    aria-label="Board auswählen"
                    value={boardId || ""}
                    onChange={(e) => setBoardId(e.target.value)}
                  >
                    {project.Boards.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {canEdit && (
                    <button
                      className="icon-button"
                      title="Board hinzufügen"
                      aria-label="Board hinzufügen"
                      onClick={() => setModal({ type: "board" })}
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
              </div>
              {subview !== "activity" && (
                <div className="board-toolbar">
                  <div className="toolbar-left">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Aufgaben suchen"
                        placeholder="Aufgaben suchen …"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button
                          className="icon-button"
                          aria-label="Suche löschen"
                          onClick={() => setSearch("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <label className="filter-select">
                      <SlidersHorizontal size={15} />
                      <select
                        aria-label="Priorität filtern"
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                      >
                        <option value="all">Alle Prioritäten</option>
                        {Object.entries(priorities).map(([key, p]) => (
                          <option key={key} value={key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className={`button filter-button ${mineFilter ? "is-active" : ""}`}
                      onClick={() => setMineFilter(!mineFilter)}
                    >
                      <Avatar user={user} size="tiny" />
                      Meine Aufgaben
                    </button>
                  </div>
                  <div className="toolbar-right">
                    {board && canEdit && (
                      <button
                        className="button secondary"
                        aria-label="Buckets bearbeiten"
                        onClick={() => setModal({ type: "columns" })}
                      >
                        <Settings size={17} />
                        Buckets bearbeiten
                      </button>
                    )}
                    {canEdit && (
                      <button
                        className="button primary"
                        disabled={!board || busy}
                        onClick={() =>
                          setModal({
                            type: "card",
                            columnId: board.columns[0].id,
                          })
                        }
                      >
                        <Plus size={17} />
                        Aufgabe erstellen
                      </button>
                    )}
                  </div>
                </div>
              )}
              {loadError ? (
                <div className="board-content">
                  <Empty icon={AlertCircle} title="Board nicht verfügbar">
                    {loadError}
                  </Empty>
                  <button
                    className="button secondary"
                    onClick={() => refreshBoard()}
                  >
                    Erneut laden
                  </button>
                </div>
              ) : !board ? (
                <div className="board-content loading-board">
                  <Spinner />
                  <span>Board wird geladen …</span>
                </div>
              ) : subview === "activity" ? (
                <ActivityView activities={activity} />
              ) : subview === "list" ? (
                <TaskList
                  cards={filtered}
                  board={board}
                  onOpen={(c) => setModal({ type: "card", card: c })}
                />
              ) : (
                <Kanban
                  board={board}
                  cards={filtered}
                  canEdit={canEdit && !busy}
                  onMove={move}
                  onOpen={(c) => setModal({ type: "card", card: c })}
                  onAdd={(col) => setModal({ type: "card", columnId: col })}
                />
              )}
              <div className="board-footer">
                <span>
                  <span className="live-dot" /> Änderungen werden alle 5
                  Sekunden synchronisiert
                </span>
                <span>
                  Karten am Griff ziehen · Touch & Tastatur unterstützt
                </span>
              </div>
            </>
          ) : (
            <div className="page-content">
              <Empty icon={FolderOpen} title="Platz für dein nächstes Projekt">
                Lege ein Projekt an, lade dein Team ein und bringt eure Ideen
                gemeinsam voran.
              </Empty>
              <button
                className="button primary"
                onClick={() => setModal({ type: "project" })}
              >
                <Plus size={17} />
                Erstes Projekt erstellen
              </button>
            </div>
          ))}
      </main>
      {modal?.type === "project" && (
        <ProjectModal
          project={modal.project}
          onClose={() => setModal(null)}
          onSaved={async (id) => {
            await reloadProjects();
            selectProject(id);
            setModal(null);
            notify("Projekt gespeichert");
          }}
          onDeleted={async () => {
            await reloadProjects();
            setProjectId(null);
            setModal(null);
            setView("projects");
            notify("Projekt gelöscht");
          }}
        />
      )}
      {modal?.type === "board" && (
        <BoardModal
          project={project}
          onClose={() => setModal(null)}
          onSaved={async (b) => {
            await reloadProjects();
            setBoardId(b.id);
            setModal(null);
            notify("Board erstellt");
          }}
        />
      )}
      {modal?.type === "columns" && (
        <ColumnsModal
          board={board}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await refreshBoard();
            setModal(null);
            notify("Buckets gespeichert");
          }}
        />
      )}
      {modal?.type === "card" && (
        <CardModal
          card={modal.card}
          columnId={modal.columnId}
          board={board}
          members={members}
          user={user}
          canEdit={canEdit}
          onChanged={() => refreshBoard()}
          onClose={() => {
            setModal(null);
            refreshBoard();
          }}
          onSaved={async () => {
            setModal(null);
            await refreshBoard();
            notify("Aufgabe gespeichert");
          }}
          notify={notify}
        />
      )}
      {modal?.type === "members" && (
        <MembersModal
          project={project}
          members={members}
          onClose={() => setModal(null)}
          onChanged={async () =>
            setMembers(await api(`/projects/${project.id}/members`))
          }
          notify={notify}
        />
      )}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Meldung schließen"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      <span>
        projekt<span>werk</span>
        <em>·</em>
      </span>
    </div>
  );
}
function AuthScreen({ info, onSuccess, invitation = null, token }) {
  const [error, setError] = useState(
      new URLSearchParams(location.search).get("authError") || "",
    ),
    [busy, setBusy] = useState(false),
    [method, setMethod] = useState(info.provider === "ldap" ? "ldap" : "local");
  const setup = info.setupRequired;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      onSuccess(
        await api(setup ? "/setup" : "/auth/login", {
          method: "POST",
          body: setup
            ? {
                name: f.get("name"),
                email: f.get("email"),
                password: f.get("password"),
                sample: f.get("sample") === "on",
              }
            : {
                email: f.get("email"),
                password: f.get("password"),
                method,
                invite: token,
              },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <Brand />
        <div className="auth-copy">
          <span className="auth-eyebrow">VON DER IDEE ZUM ERGEBNIS</span>
          <h1>
            Gute Projekte.
            <br />
            Starke Teams.
            <br />
            <span>Ein gemeinsamer Ort.</span>
          </h1>
          <p>
            Plane Aufgaben, teile Ideen und behalte den Überblick. So einfach
            kann Zusammenarbeit sein.
          </p>
          <div className="auth-benefits">
            <span>
              <CheckCircle2 size={18} />
              Alle Projekte im Blick
            </span>
            <span>
              <CheckCircle2 size={18} />
              Gemeinsam vorankommen
            </span>
            <span>
              <CheckCircle2 size={18} />
              Auf jedem Gerät zu Hause
            </span>
          </div>
        </div>
        <div className="auth-art">
          <div className="mini-column">
            <i />
            <span />
            <span />
          </div>
          <div className="mini-column">
            <i />
            <span />
            <span className="mini-highlight" />
          </div>
          <div className="mini-column">
            <i />
            <span />
          </div>
          <div className="floating-check">
            <Check size={26} />
          </div>
        </div>
        <span className="auth-footnote">Für Teams, die etwas bewegen.</span>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form">
          <div className="auth-logo-mobile">
            <Brand />
          </div>
          <span className="eyebrow">
            {setup ? "DEIN NEUER ARBEITSBEREICH" : "WILLKOMMEN ZURÜCK"}
          </span>
          <h2>{setup ? "Lass uns loslegen." : "Schön, dass du da bist."}</h2>
          <p>
            {setup
              ? "Erstelle dein Administratorkonto und starte dein erstes Projekt."
              : invitation
                ? `Melde dich an, um „${invitation.project}“ beizutreten.`
                : "Melde dich an und mach dort weiter, wo du aufgehört hast."}
          </p>
          {!setup && info.provider === "oidc" && (
            <>
              <a
                className="button sso-button"
                href={`/api/auth/oidc${token ? `?invite=${token}` : ""}`}
              >
                <Shield size={18} />
                {info.providerName}
                <ArrowRight size={16} />
              </a>
              <div className="form-divider">
                <span>oder mit lokalem Konto</span>
              </div>
            </>
          )}
          {!setup && info.provider === "ldap" && (
            <div className="segmented">
              <button
                className={method === "ldap" ? "active" : ""}
                onClick={() => setMethod("ldap")}
              >
                Active Directory
              </button>
              <button
                className={method === "local" ? "active" : ""}
                onClick={() => setMethod("local")}
              >
                Lokales Konto
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            {setup && (
              <label>
                Dein Name
                <input
                  name="name"
                  placeholder="Vorname Nachname"
                  required
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              {method === "ldap" && !setup
                ? "AD-Benutzername"
                : "E-Mail-Adresse"}
              <div className="input-with-icon">
                <Mail size={17} />
                <input
                  name="email"
                  type={method === "ldap" && !setup ? "text" : "email"}
                  placeholder={
                    method === "ldap" && !setup
                      ? "Dein Benutzername"
                      : "du@unternehmen.de"
                  }
                  defaultValue={invitation?.email}
                  required
                  autoComplete="username"
                />
              </div>
            </label>
            <label>
              Passwort
              <div className="input-with-icon">
                <Lock size={17} />
                <input
                  name="password"
                  type="password"
                  required
                  minLength={setup ? 10 : 1}
                  maxLength={setup ? 72 : 200}
                  placeholder={
                    setup ? "Mindestens 10 Zeichen" : "Dein Passwort"
                  }
                  autoComplete={setup ? "new-password" : "current-password"}
                />
              </div>
            </label>
            {setup && (
              <label className="checkbox-label">
                <input type="checkbox" name="sample" defaultChecked />
                <span>Mit einem Beispielprojekt starten</span>
              </label>
            )}
            <FormError error={error} />
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : setup ? (
                "Arbeitsbereich erstellen"
              ) : (
                "Anmelden"
              )}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>
          <div className="auth-help">
            <Shield size={15} />
            <span>
              {setup
                ? "Dein Konto verwaltet Projekte, Mitglieder und Anmeldeanbieter."
                : "Dein Zugang wird von deinem Administrator verwaltet."}
            </span>
          </div>
        </div>
        <span className="login-bottom">
          Projektwerk · Gemeinsam mehr bewegen
        </span>
      </div>
    </div>
  );
}
function InviteScreen({ token, user, publicInfo, onLogin, onDone }) {
  const [info, setInfo] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [login, setLogin] = useState(false);
  useEffect(() => {
    api(`/invitations/${token}`)
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [token]);
  async function accept(e) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    const f = e ? new FormData(e.currentTarget) : null;
    try {
      onDone(
        await api(`/invitations/${token}/accept`, {
          method: "POST",
          body: f ? { name: f.get("name"), password: f.get("password") } : {},
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (login && !user)
    return (
      <AuthScreen
        info={publicInfo}
        invitation={info}
        token={token}
        onSuccess={(u) => {
          onLogin(u);
          setLogin(false);
        }}
      />
    );
  return (
    <div className="invitation-page">
      <Brand />
      <div className="invitation-card">
        <div className="invitation-illustration">
          <Users size={34} />
        </div>
        <span className="eyebrow">GEMEINSAM GEHT MEHR</span>
        <h1>Du bist eingeladen.</h1>
        {info ? (
          <>
            <p>
              Werde Teil von <strong>{info.project}</strong>.
            </p>
            <div className="invitation-details">
              <span>
                <Mail size={16} />
                {info.email}
              </span>
              <span>
                <Shield size={16} />
                {roleNames[info.role]}
              </span>
            </div>
            {user ? (
              <>
                <p>Angemeldet als {user.email}</p>
                <button
                  className="button primary full"
                  disabled={busy || user.email !== info.email}
                  onClick={() => accept()}
                >
                  {busy ? <Spinner /> : "Projekt beitreten"}
                  <ArrowRight size={17} />
                </button>
                {user.email !== info.email && (
                  <p className="form-error">
                    Bitte melde dich zuerst mit dem eingeladenen Konto an.
                  </p>
                )}
              </>
            ) : (
              <>
                <form onSubmit={accept}>
                  <label>
                    Dein Name
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Neues Passwort
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={10}
                      maxLength={72}
                      placeholder="Mindestens 10 Zeichen"
                    />
                  </label>
                  <button className="button primary full" disabled={busy}>
                    {busy ? <Spinner /> : "Konto erstellen & beitreten"}
                    <ArrowRight size={17} />
                  </button>
                </form>
                <button
                  className="text-button full"
                  onClick={() => setLogin(true)}
                >
                  Bereits ein Konto oder Firmenanmeldung? Anmelden
                </button>
              </>
            )}
          </>
        ) : !error ? (
          <Spinner />
        ) : null}
        <FormError error={error} />
        <a className="text-button" href="/">
          Zum Arbeitsbereich
        </a>
      </div>
    </div>
  );
}
function TaskCard({
  card,
  onOpen,
  dragHandle,
  dragProps,
  style,
  dragging = false,
}) {
  const p = priorities[card.priority],
    done = card.checklist?.filter((i) => i.done).length || 0,
    total = card.checklist?.length || 0;
  const overdue =
    card.dueDate && card.dueDate < new Date().toLocaleDateString("sv-SE");
  return (
    <article
      className={`task-card ${dragging ? "dragging" : ""}`}
      style={style}
      {...dragProps}
    >
      <div className="card-top">
        <div className="card-labels">
          {card.labels.map((l, i) => (
            <span className={`label-chip label-${i % 4}`} key={l}>
              {l}
            </span>
          ))}
        </div>
        {dragHandle}
      </div>
      <button className="card-title" onClick={() => onOpen?.(card)}>
        {card.title}
      </button>
      {card.description && (
        <p className="card-preview" onClick={() => onOpen?.(card)}>
          {card.description}
        </p>
      )}
      <div className="card-completion">
        <span>Fortschritt</span>
        <strong>{card.progress ?? 0} %</strong>
        <progress
          aria-label={`Fortschritt: ${card.title}`}
          max={100}
          value={card.progress ?? 0}
        />
      </div>
      {total > 0 && (
        <div
          className="card-progress"
          title={`${done} von ${total} Checklistenpunkten erledigt`}
        >
          <div>
            <i style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span>
            <CheckSquare size={12} />
            {done}/{total}
          </span>
        </div>
      )}
      <div className="card-details">
        <span className={`priority priority-${p.color}`}>
          <Flag size={11} />
          {p.label}
        </span>
        {card.dueDate && (
          <span className={`due-date ${overdue ? "overdue" : ""}`}>
            <CalendarDays size={12} />
            {shortDate(card.dueDate)}
          </span>
        )}
      </div>
      <div className="card-bottom">
        <div className="card-counts">
          {card.commentCount > 0 && (
            <span title="Kommentare">
              <MessageSquare size={13} />
              {card.commentCount}
            </span>
          )}
          {card.attachmentCount > 0 && (
            <span title="Anhänge">
              <Paperclip size={13} />
              {card.attachmentCount}
            </span>
          )}
          {!card.commentCount && !card.attachmentCount && (
            <span className="card-id">Aufgabe</span>
          )}
        </div>
        {card.assignee ? (
          <Avatar user={card.assignee} size="tiny" />
        ) : (
          <span className="unassigned" title="Noch nicht zugewiesen">
            <Users size={12} />
          </span>
        )}
      </div>
    </article>
  );
}
function SortableCard({ card, onOpen, canEdit }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: !canEdit });
  return (
    <TaskCard
      card={card}
      onOpen={onOpen}
      dragging={isDragging}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      dragProps={{ ref: setNodeRef }}
      dragHandle={
        canEdit ? (
          <button
            ref={setActivatorNodeRef}
            className="drag-handle"
            {...attributes}
            {...listeners}
            aria-label={`Aufgabe ${card.title} verschieben`}
          >
            <GripVertical size={15} />
          </button>
        ) : null
      }
    />
  );
}
function Column({ column, cards, onOpen, onAdd, canEdit }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${isOver ? "drop-target" : ""}`}
    >
      <div className="column-heading">
        <div>
          <span className="column-dot" style={{ background: column.color }} />
          <h3>{column.name}</h3>
          <span className="column-count">{cards.length}</span>
        </div>
        {canEdit && (
          <button
            className="icon-button"
            aria-label={`Aufgabe in ${column.name} erstellen`}
            onClick={() => onAdd(column.id)}
          >
            <Plus size={17} />
          </button>
        )}
      </div>
      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="column-cards">
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              onOpen={onOpen}
              canEdit={canEdit}
            />
          ))}
          {cards.length === 0 && (
            <div className="column-empty">Platz für den nächsten Schritt</div>
          )}
        </div>
      </SortableContext>
      {canEdit && (
        <button className="column-add" onClick={() => onAdd(column.id)}>
          <Plus size={15} />
          Aufgabe hinzufügen
        </button>
      )}
    </section>
  );
}
function Kanban({ board, cards, canEdit, onMove, onOpen, onAdd }) {
  const [active, setActive] = useState(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function end({ active, over }) {
    setActive(null);
    if (!over || over.id === active.id) return;
    const card = board.cards.find((c) => c.id === active.id),
      target = board.cards.find((c) => c.id === over.id),
      col = target?.columnId || over.id;
    if (!card || !board.columns.some((c) => c.id === col)) return;
    const inColumn = board.cards.filter(
      (c) => c.columnId === col && c.id !== card.id,
    );
    const original = board.cards.filter((c) => c.columnId === col);
    const movingDown =
      target &&
      card.columnId === col &&
      original.findIndex((c) => c.id === card.id) <
        original.findIndex((c) => c.id === target.id);
    const index = target
      ? Math.max(
          0,
          inColumn.findIndex((c) => c.id === target.id),
        ) + (movingDown ? 1 : 0)
      : inColumn.length;
    onMove(card.id, col, index);
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const inside = pointerWithin(args);
        return inside.length ? inside : closestCorners(args);
      }}
      onDragStart={({ active }) =>
        setActive(board.cards.find((c) => c.id === active.id))
      }
      onDragEnd={end}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Leertaste drücken, mit Pfeiltasten verschieben und erneut Leertaste zum Ablegen drücken. Escape bricht ab.",
        },
      }}
    >
      <div
        className="kanban-board"
        style={{ "--columns": board.columns.length }}
      >
        {board.columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            cards={cards.filter((c) => c.columnId === col.id)}
            canEdit={canEdit}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}
      </div>
      <DragOverlay>{active ? <TaskCard card={active} /> : null}</DragOverlay>
    </DndContext>
  );
}
function TaskList({ cards, board, onOpen }) {
  return (
    <div className="table-wrap">
      <table className="task-table">
        <thead>
          <tr>
            <th>Aufgabe</th>
            <th>Status</th>
            <th>Fortschritt</th>
            <th>Priorität</th>
            <th>Fällig am</th>
            <th>Verantwortlich</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c)}>
              <td>
                <button className="table-title">{c.title}</button>
                {c.checklist?.length > 0 && (
                  <small>
                    {c.checklist.filter((i) => i.done).length}/
                    {c.checklist.length} erledigt
                  </small>
                )}
              </td>
              <td>
                <span className="status-pill">
                  <i
                    style={{
                      background: board.columns.find(
                        (col) => col.id === c.columnId,
                      )?.color,
                    }}
                  />
                  {board.columns.find((col) => col.id === c.columnId)?.name}
                </span>
              </td>
              <td>{c.progress ?? 0} %</td>
              <td>
                <span
                  className={`priority priority-${priorities[c.priority].color}`}
                >
                  {priorities[c.priority].label}
                </span>
              </td>
              <td>{shortDate(c.dueDate) || "—"}</td>
              <td>
                {c.assignee ? (
                  <div className="table-user">
                    <Avatar user={c.assignee} size="tiny" />
                    {c.assignee.name}
                  </div>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cards.length === 0 && (
        <Empty title="Keine passenden Aufgaben">
          Passe deine Filter an oder erstelle eine neue Aufgabe.
        </Empty>
      )}
    </div>
  );
}
function ActivityView({ activities }) {
  return (
    <div className="activity-page">
      <div className="section-heading">
        <h2>Was sich bewegt hat</h2>
        <p>Die letzten 100 Änderungen in diesem Board.</p>
      </div>
      {activities.length ? (
        activities.map((a) => (
          <div className="activity-item" key={a.id}>
            <Avatar user={a.User} />
            <div>
              <p>
                <strong>{a.User?.name}</strong>{" "}
                <span>{a.action.toLowerCase()}</span>
              </p>
              {a.cardTitle && (
                <span className="activity-card-title">{a.cardTitle}</span>
              )}
            </div>
            <time>{dateTime(a.createdAt)}</time>
          </div>
        ))
      ) : (
        <Empty icon={Clock} title="Hier entsteht eure Geschichte">
          Sobald ihr Aufgaben erstellt, kommentiert oder verschiebt, erscheinen
          die Änderungen hier.
        </Empty>
      )}
    </div>
  );
}
function ProjectOverview({ projects, onSelect, onCreate }) {
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEIN ARBEITSBEREICH</span>
          <h1>Alles beginnt mit einer Idee.</h1>
          <p>Deine Projekte. Dein Team. Euer nächster Schritt.</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={17} />
          Neues Projekt
        </button>
      </div>
      <div className="overview-stats">
        <div>
          <span>Projekte</span>
          <strong>{projects.filter((p) => !p.archived).length}</strong>
        </div>
        <div>
          <span>Boards</span>
          <strong>{projects.reduce((n, p) => n + p.Boards.length, 0)}</strong>
        </div>
        <div>
          <span>Archiviert</span>
          <strong>{projects.filter((p) => p.archived).length}</strong>
        </div>
      </div>
      <div className="section-heading">
        <h2>
          Deine Projekte <span className="number-badge">{projects.length}</span>
        </h2>
      </div>
      <div className="project-grid">
        {projects.map((p) => (
          <button
            className="project-tile"
            key={p.id}
            onClick={() => onSelect(p.id)}
          >
            <div className="project-tile-top">
              <ProjectIcon project={p} />
              <ArrowUpRight size={18} />
            </div>
            <h3>{p.name}</h3>
            <p>
              {p.description ||
                "Ein neuer Ort für gemeinsame Ideen und Aufgaben."}
            </p>
            <div className="project-tile-footer">
              <span>
                <Layers size={14} />
                {p.Boards.length} Boards
              </span>
              <span className="badge gray">
                {p.archived ? "Archiviert" : roleNames[p.myRole]}
              </span>
            </div>
          </button>
        ))}
        <button className="project-tile new-tile" onClick={onCreate}>
          <span>
            <Plus size={24} />
          </span>
          <h3>Etwas Neues starten</h3>
          <p>Erstelle ein Projekt und bring dein Team zusammen.</p>
        </button>
      </div>
    </div>
  );
}
function MyTasks({ projects, user, onSelect }) {
  const [groups, setGroups] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all(
      projects.flatMap((p) =>
        p.Boards.map(async (b) => {
          const board = await api(`/boards/${b.id}`);
          return {
            project: p,
            board,
            cards: board.cards.filter(
              (c) => c.assigneeId === user.id && !cardIsDone(board, c),
            ),
          };
        }),
      ),
    )
      .then((data) => {
        if (live) setGroups(data.filter((g) => g.cards.length));
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [projects, user.id]);
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEIN FOKUS</span>
          <h1>Meine Aufgaben</h1>
          <p>Was als Nächstes ansteht – über alle Projekte hinweg.</p>
        </div>
      </div>
      <FormError error={error} />
      {groups === null ? (
        <Spinner />
      ) : !groups.length ? (
        <Empty icon={CheckCircle2} title="Alles im grünen Bereich">
          Dir sind gerade keine offenen Aufgaben zugewiesen.
        </Empty>
      ) : (
        groups.map((g) => (
          <section className="my-task-group" key={g.board.id}>
            <div className="section-heading">
              <h2>
                <ProjectIcon project={g.project} />
                {g.project.name} <span className="muted">/ {g.board.name}</span>
              </h2>
              <button
                className="text-button"
                onClick={() => onSelect(g.project.id, g.board.id)}
              >
                Zum Board <ArrowRight size={15} />
              </button>
            </div>
            <TaskList
              board={g.board}
              cards={g.cards}
              onOpen={() => onSelect(g.project.id, g.board.id)}
            />
          </section>
        ))
      )}
    </div>
  );
}
function ProjectModal({ project, onClose, onSaved, onDeleted }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedColor, setColor] = useState(project?.color || palette[0]),
    [selectedIcon, setIcon] = useState(project?.icon || "layers"),
    [confirmDelete, setConfirmDelete] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const data = {
        name: f.get("name"),
        description: f.get("description"),
        color: selectedColor,
        ...(!project
          ? { icon: selectedIcon }
          : { archived: f.get("archived") === "on" }),
      };
      const result = await api(
        project ? `/projects/${project.id}` : "/projects",
        { method: project ? "PATCH" : "POST", body: data },
      );
      await onSaved(project?.id || result.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/projects/${project.id}`, { method: "DELETE" });
      await onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project ? "Projekteinstellungen" : "Ein neues Kapitel."}
      subtitle={
        project
          ? "Passe dein Projekt an."
          : "Gib deiner Idee einen gemeinsamen Platz."
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label>
          Projektname
          <input
            name="name"
            defaultValue={project?.name}
            required
            maxLength={100}
            placeholder="z. B. Website-Relaunch"
            autoFocus
          />
        </label>
        <label>
          Beschreibung
          <textarea
            name="description"
            defaultValue={project?.description}
            maxLength={5000}
            rows={3}
            placeholder="Was möchtet ihr gemeinsam erreichen?"
          />
        </label>
        <label>
          Projektfarbe
          <div className="color-picker">
            {palette.map((c) => (
              <button
                type="button"
                className={c === selectedColor ? "picked" : ""}
                style={{ background: c }}
                key={c}
                aria-label={`Farbe ${c}`}
                onClick={() => setColor(c)}
              >
                {c === selectedColor && <Check size={16} />}
              </button>
            ))}
          </div>
        </label>
        {!project && (
          <label>
            Projektsymbol
            <div className="icon-picker">
              {Object.entries(icons).map(([key, Icon]) => (
                <button
                  type="button"
                  key={key}
                  className={key === selectedIcon ? "picked" : ""}
                  aria-label={`Symbol ${key}`}
                  onClick={() => setIcon(key)}
                >
                  <Icon size={20} />
                </button>
              ))}
            </div>
          </label>
        )}
        {project && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={project.archived}
            />
            Projekt archivieren
          </label>
        )}
        <FormError error={error} />
        <div className="modal-actions">
          {project && (
            <button
              type="button"
              className="button danger-text push-right"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} />
              Löschen
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : project ? "Speichern" : "Projekt erstellen"}
          </button>
        </div>
        {confirmDelete && (
          <div className="delete-confirmation">
            <strong>Projekt endgültig löschen?</strong>
            <p>
              Alle Boards, Aufgaben, Kommentare und Anhänge werden gelöscht.
            </p>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={remove}
            >
              Ja, Projekt löschen
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setConfirmDelete(false)}
            >
              Behalten
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
function BoardModal({ project, onClose, onSaved }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      onSaved(
        await api(`/projects/${project.id}/boards`, {
          method: "POST",
          body: { name: f.get("name") },
        }),
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Ein neues Board"
      subtitle="Ein eigener Überblick für den nächsten Teil deines Projekts."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label>
          Boardname
          <input
            name="name"
            placeholder="z. B. Produktentwicklung"
            required
            maxLength={100}
            autoFocus
          />
        </label>
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : "Board erstellen"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ColumnsModal({ board, onClose, onSaved }) {
  const [currentBoard, setCurrentBoard] = useState(board);
  const revision = useRef(board.revision);
  const initialColumns = (columns) =>
    columns.map((c) => ({
      ...c,
      isDone: bucketIsDone(columns, c),
    }));
  const [cols, setCols] = useState(() => initialColumns(board.columns)),
    [boardName, setBoardName] = useState(board.name),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false);
  function changeColumn(id, fields) {
    setCols((current) =>
      current.map((c) => (c.id === id ? { ...c, ...fields } : c)),
    );
  }
  function moveColumn(index, offset) {
    setCols((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  async function reload() {
    setBusy(true);
    try {
      const latest = await api(`/boards/${board.id}`);
      revision.current = latest.revision;
      setCurrentBoard(latest);
      setCols(initialColumns(latest.columns));
      setBoardName(latest.name);
      setError("");
      setConflict(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/boards/${board.id}`, {
        method: "PATCH",
        body: { name: boardName, columns: cols, revision: revision.current },
      });
      await onSaved();
    } catch (e) {
      setConflict(e.status === 409);
      setError(
        e.status === 409
          ? "Das Board wurde inzwischen geändert. Lade den aktuellen Stand; deine Bucket-Entwürfe werden dabei verworfen."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Board & Buckets"
      subtitle="Eigene Überschriften, Farben und Reihenfolge für euer Team."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label>
          Boardname
          <input
            value={boardName}
            onChange={(e) => setBoardName(e.target.value)}
            required
            maxLength={100}
            disabled={busy}
          />
        </label>
        <label>Buckets</label>
        <p className="bucket-note">
          1–12 Buckets. Markiere die Buckets, deren Aufgaben als erledigt
          gelten. Zum Entfernen eines Buckets zuerst seine Aufgaben verschieben.
        </p>
        <div className="columns-editor">
          {cols.map((c, index) => {
            const occupied = currentBoard.cards.some(
              (card) => card.columnId === c.id,
            );
            return (
              <div className="bucket-editor-row" key={c.id}>
                <div className="bucket-editor-heading">
                  <input
                    type="color"
                    aria-label={`Farbe für ${c.name}`}
                    value={c.color}
                    disabled={busy}
                    onChange={(e) =>
                      changeColumn(c.id, { color: e.target.value })
                    }
                  />
                  <input
                    type="text"
                    aria-label={`Bucket ${index + 1}`}
                    value={c.name}
                    required
                    maxLength={100}
                    disabled={busy}
                    onChange={(e) =>
                      changeColumn(c.id, { name: e.target.value })
                    }
                  />
                </div>
                <div className="bucket-editor-controls">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={c.isDone}
                      disabled={busy}
                      aria-label={`Aufgaben in ${c.name} gelten als erledigt`}
                      onChange={(e) =>
                        changeColumn(c.id, { isDone: e.target.checked })
                      }
                    />
                    Erledigt-Bucket
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${c.name} nach oben`}
                    disabled={busy || index === 0}
                    onClick={() => moveColumn(index, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${c.name} nach unten`}
                    disabled={busy || index === cols.length - 1}
                    onClick={() => moveColumn(index, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${c.name} entfernen`}
                    disabled={busy || cols.length === 1 || occupied}
                    title={
                      occupied
                        ? "Zuerst die Aufgaben in einen anderen Bucket verschieben"
                        : cols.length === 1
                          ? "Mindestens ein Bucket muss bleiben"
                          : "Bucket entfernen"
                    }
                    onClick={() =>
                      setCols((current) =>
                        current.filter((col) => col.id !== c.id),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy || cols.length >= 12}
          onClick={() =>
            setCols((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                name: "Neuer Bucket",
                color: "#94a3b8",
                isDone: false,
              },
            ])
          }
        >
          <Plus size={16} /> Bucket hinzufügen
        </button>
        <FormError error={error} />
        {conflict && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={reload}
          >
            Aktuellen Stand laden
          </button>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="button primary" disabled={busy || conflict}>
            {busy ? <Spinner /> : "Speichern"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CardModal({
  card,
  columnId,
  board,
  members,
  user,
  canEdit,
  onChanged,
  onClose,
  onSaved,
  notify,
}) {
  const defaults = (c) => ({
    title: c?.title || "",
    description: c?.description || "",
    columnId: c?.columnId || columnId || board.columns[0].id,
    priority: c?.priority || "medium",
    progress: c?.progress ?? 0,
    dueDate: c?.dueDate || "",
    assigneeId: c?.assigneeId || "",
    labels: c?.labels.join(", ") || "",
    checklist: c?.checklist?.map((i) => ({ ...i })) || [],
    version: c?.version ?? 0,
  });
  const [data, setData] = useState(defaults(card)),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false),
    [comments, setComments] = useState([]),
    [files, setFiles] = useState([]),
    [comment, setComment] = useState(""),
    [newItem, setNewItem] = useState(""),
    [tab, setTab] = useState("details"),
    [uploading, setUploading] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [saveStatus, setSaveStatus] = useState("saved");
  const autosaveRef = useRef(null);
  function bodyFields(fields) {
    const body = { ...fields };
    if ("dueDate" in body) body.dueDate ||= null;
    if ("assigneeId" in body) body.assigneeId ||= null;
    if ("labels" in body)
      body.labels = [
        ...new Set(
          body.labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean),
        ),
      ];
    return body;
  }
  if (card && canEdit && !autosaveRef.current) {
    autosaveRef.current = new CardAutosave(defaults(card), {
      persist: async (fields, version) => {
        const result = await api(`/cards/${card.id}`, {
          method: "PATCH",
          body: { ...bodyFields(fields), version },
        });
        return result.version;
      },
      onStatus: setSaveStatus,
      onError: (e) => {
        setError(e.message);
        setConflict(e.status === 409);
      },
      onSaved: (version) => {
        setData((d) => ({ ...d, version }));
        setError("");
        onChanged();
      },
    });
  }
  const autosave = autosaveRef.current;
  useEffect(() => () => autosave?.dispose(), [autosave]);
  const field = (key, value, deferred = false) => {
    setData((d) => ({ ...d, [key]: value }));
    autosave?.change(key, value, deferred);
  };
  async function close() {
    if (!autosave || (await autosave.flush())) onClose();
  }
  const fileRef = useRef();
  useEffect(() => {
    if (!card) return;
    Promise.all([
      api(`/cards/${card.id}/comments`),
      api(`/cards/${card.id}/attachments`),
    ])
      .then(([c, f]) => {
        setComments(c);
        setFiles(f);
      })
      .catch((e) => setError(e.message));
  }, [card?.id]);
  async function submit(e) {
    e.preventDefault();
    if (autosave) {
      await autosave.flush();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        ...bodyFields(data),
      };
      await api(card ? `/cards/${card.id}` : `/boards/${board.id}/cards`, {
        method: card ? "PATCH" : "POST",
        body,
      });
      await onSaved();
    } catch (e) {
      setError(e.message);
      setConflict(e.status === 409);
      setBusy(false);
    }
  }
  async function reload() {
    try {
      await autosave?.flight;
      const latest = await api(`/boards/${board.id}`);
      const found = latest.cards.find((c) => c.id === card.id);
      if (!found) throw new Error("Diese Aufgabe wurde gelöscht.");
      const fresh = defaults(found);
      autosave?.reset(fresh);
      setData(fresh);
      setConflict(false);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      if (autosave && !(await autosave.flush())) {
        setBusy(false);
        return;
      }
      await api(`/cards/${card.id}`, {
        method: "DELETE",
        body: { version: autosave?.version ?? data.version },
      });
      onSaved();
    } catch (e) {
      setError(e.message);
      setConflict(e.status === 409);
      setBusy(false);
    }
  }
  function addItem(e) {
    e?.preventDefault();
    if (!newItem.trim()) return;
    field("checklist", [
      ...data.checklist,
      { id: crypto.randomUUID(), text: newItem.trim(), done: false },
    ]);
    setNewItem("");
  }
  async function addComment(e) {
    e.preventDefault();
    if (!comment.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/cards/${card.id}/comments`, {
        method: "POST",
        body: { body: comment },
      });
      setComments(await api(`/cards/${card.id}/comments`));
      setComment("");
      notify("Kommentar hinzugefügt");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("Die Datei darf maximal 20 MB groß sein.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const f = new FormData();
      f.append("file", file);
      await api(`/cards/${card.id}/attachments`, { method: "POST", body: f });
      setFiles(await api(`/cards/${card.id}/attachments`));
      notify("Datei hochgeladen");
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function removeFile(id) {
    try {
      await api(`/attachments/${id}`, { method: "DELETE" });
      setFiles(files.filter((f) => f.id !== id));
      notify("Anhang entfernt");
    } catch (e) {
      setError(e.message);
    }
  }
  const done = data.checklist.filter((i) => i.done).length;
  return (
    <Modal
      wide
      title={card ? "Aufgabendetails" : "Der nächste Schritt."}
      subtitle={
        card
          ? `In ${board.name}`
          : "Eine gute Aufgabe macht klar, was zu tun ist."
      }
      onClose={close}
    >
      <div className="detail-tabs">
        <button
          className={tab === "details" ? "active" : ""}
          onClick={() => setTab("details")}
        >
          <FileText size={15} />
          Details
        </button>
        <button
          className={tab === "files" ? "active" : ""}
          onClick={() => setTab("files")}
        >
          <Paperclip size={15} />
          Anhänge <span>{files.length}</span>
        </button>
        <button
          className={tab === "comments" ? "active" : ""}
          onClick={() => setTab("comments")}
        >
          <MessageSquare size={15} />
          Kommentare <span>{comments.length}</span>
        </button>
      </div>
      {card && canEdit && (
        <div
          className={`autosave-status autosave-${saveStatus}`}
          role="status"
          aria-live="polite"
        >
          {saveStatus === "saving" ? (
            <Spinner />
          ) : saveStatus === "saved" ? (
            <Check size={14} />
          ) : (
            <Clock size={14} />
          )}
          {saveStatus === "saving"
            ? "Wird gespeichert …"
            : saveStatus === "pending"
              ? "Änderungen ausstehend"
              : saveStatus === "error"
                ? "Nicht gespeichert"
                : "Alle Änderungen gespeichert"}
          {saveStatus === "error" && !conflict && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setError("");
                autosave.retry();
              }}
            >
              Erneut versuchen
            </button>
          )}
        </div>
      )}
      <FormError error={error} />
      {conflict && (
        <button type="button" className="text-button" onClick={reload}>
          <RefreshCw size={15} />
          Aktuelle Karte laden (eigene Änderungen verwerfen)
        </button>
      )}
      {tab === "details" && (
        <form onSubmit={submit}>
          <fieldset disabled={!canEdit || busy}>
            <label>
              Titel
              <input
                value={data.title}
                onChange={(e) => field("title", e.target.value, true)}
                onBlur={() => autosave?.finish("title")}
                required
                maxLength={200}
                placeholder="Was soll erledigt werden?"
                autoFocus
              />
            </label>
            <label>
              Beschreibung
              <textarea
                aria-label="Beschreibung"
                value={data.description}
                onChange={(e) => field("description", e.target.value, true)}
                onBlur={() => autosave?.finish("description")}
                rows={4}
                maxLength={20000}
                placeholder="Hintergrund, Ziele und alles, was dein Team wissen sollte …"
              />
            </label>
            <div className="form-grid">
              <label>
                Status
                <select
                  aria-label="Status"
                  value={data.columnId}
                  onChange={(e) => field("columnId", e.target.value)}
                >
                  {board.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priorität
                <select
                  aria-label="Priorität"
                  value={data.priority}
                  onChange={(e) => field("priority", e.target.value)}
                >
                  {Object.entries(priorities).map(([key, p]) => (
                    <option value={key} key={key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Verantwortlich
                <select
                  aria-label="Verantwortlich"
                  value={data.assigneeId}
                  onChange={(e) => field("assigneeId", e.target.value)}
                >
                  <option value="">Noch nicht zugewiesen</option>
                  {members
                    .filter((m) => !m.disabled)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Fällig am
                <input
                  type="date"
                  value={data.dueDate}
                  onChange={(e) => field("dueDate", e.target.value)}
                />
              </label>
            </div>
            <label>
              Labels{" "}
              <span className="label-hint">mit Komma trennen, maximal 8</span>
              <input
                value={data.labels}
                onChange={(e) => field("labels", e.target.value, true)}
                onBlur={() => autosave?.finish("labels")}
                placeholder="z. B. Design, Entwicklung"
                maxLength={248}
              />
            </label>
            <div className="completion-field">
              <span id="task-progress-label">Fortschritt</span>
              <div
                className="completion-buttons"
                role="group"
                aria-labelledby="task-progress-label"
              >
                {[0, 25, 50, 75, 100].map((progress) => (
                  <button
                    key={progress}
                    type="button"
                    aria-pressed={data.progress === progress}
                    className={data.progress === progress ? "selected" : ""}
                    onClick={() => field("progress", progress)}
                  >
                    {progress} %
                  </button>
                ))}
              </div>
            </div>
            <div className="checklist-heading">
              <h3>
                <CheckSquare size={17} />
                Checkliste
              </h3>
              <span>
                {done} / {data.checklist.length} erledigt
              </span>
            </div>
            {data.checklist.length > 0 && (
              <div className="checklist-progress">
                <i
                  style={{ width: `${(done / data.checklist.length) * 100}%` }}
                />
              </div>
            )}
            <div className="checklist-items">
              {data.checklist.map((item) => (
                <div className={item.done ? "done" : ""} key={item.id}>
                  <input
                    type="checkbox"
                    aria-label={item.text}
                    checked={item.done}
                    onChange={(e) =>
                      field(
                        "checklist",
                        data.checklist.map((i) =>
                          i.id === item.id
                            ? { ...i, done: e.target.checked }
                            : i,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="Checklistenpunkt"
                    onBlur={() => autosave?.finish("checklist")}
                    value={item.text}
                    maxLength={300}
                    required
                    onChange={(e) =>
                      field(
                        "checklist",
                        data.checklist.map((i) =>
                          i.id === item.id ? { ...i, text: e.target.value } : i,
                        ),
                        true,
                      )
                    }
                  />
                  {canEdit && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Checklistenpunkt entfernen"
                      onClick={() =>
                        field(
                          "checklist",
                          data.checklist.filter((i) => i.id !== item.id),
                        )
                      }
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="add-checklist-item">
                <Plus size={16} />
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addItem();
                    }
                  }}
                  maxLength={300}
                  placeholder="Checklistenpunkt hinzufügen …"
                  aria-label="Neuer Checklistenpunkt"
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={!newItem.trim() || data.checklist.length >= 50}
                  onClick={addItem}
                >
                  Hinzufügen
                </button>
              </div>
            )}
          </fieldset>
          <div className="modal-actions">
            {card && canEdit && (
              <button
                type="button"
                className="button danger-text push-right"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={15} />
                Löschen
              </button>
            )}
            <button type="button" className="button secondary" onClick={close}>
              {card || !canEdit ? "Schließen" : "Abbrechen"}
            </button>
            {canEdit && !card && (
              <button className="button primary" disabled={busy || uploading}>
                {busy ? <Spinner /> : "Aufgabe erstellen"}
              </button>
            )}
            {card && saveStatus === "error" && (
              <button type="button" className="text-button" onClick={onClose}>
                Ungespeicherte Änderungen verwerfen
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="delete-confirmation">
              <strong>
                Diese Aufgabe mit Kommentaren und Anhängen löschen?
              </strong>
              <button
                type="button"
                className="button danger"
                onClick={remove}
                disabled={busy}
              >
                Endgültig löschen
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setConfirmDelete(false)}
              >
                Behalten
              </button>
            </div>
          )}
        </form>
      )}
      {tab === "files" && (
        <div className="attachment-section">
          {!card ? (
            <Empty icon={Paperclip} title="Zuerst die Aufgabe erstellen">
              Speichere deine Aufgabe. Danach kannst du Dokumente und Bilder
              anhängen.
            </Empty>
          ) : (
            <>
              {canEdit && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="visually-hidden"
                    accept=".pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.odt,.ods"
                    onChange={(e) => upload(e.target.files[0])}
                  />
                  <button
                    className="upload-zone"
                    disabled={uploading}
                    onClick={() => fileRef.current.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!uploading) upload(e.dataTransfer.files[0]);
                    }}
                  >
                    {uploading ? <Spinner /> : <CloudUpload size={30} />}
                    <strong>
                      {uploading
                        ? "Datei wird hochgeladen …"
                        : "Datei auswählen oder hier ablegen"}
                    </strong>
                    <span>
                      Dokumente, Bilder und ZIP · maximal 20 MB pro Datei
                    </span>
                  </button>
                </>
              )}
              {files.map((f) => (
                <div className="attachment-row" key={f.id}>
                  <span className="file-icon">
                    <FileText size={20} />
                  </span>
                  <div>
                    <a href={`/api/attachments/${f.id}/download`}>{f.name}</a>
                    <span>
                      {(f.size / 1024).toFixed(1)} KB · {dateTime(f.createdAt)}
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      className="icon-button"
                      aria-label={`${f.name} entfernen`}
                      onClick={() => removeFile(f.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
              {!files.length && !canEdit && (
                <Empty icon={Paperclip} title="Noch keine Anhänge">
                  Hier finden alle Dateien zu dieser Aufgabe ihren Platz.
                </Empty>
              )}
            </>
          )}
        </div>
      )}
      {tab === "comments" && (
        <div className="comments-section">
          {!card ? (
            <Empty icon={MessageSquare} title="Zuerst die Aufgabe erstellen">
              Nach dem Speichern kann dein Team hier den aktuellen Stand
              besprechen.
            </Empty>
          ) : (
            <>
              {comments.length === 0 && (
                <Empty
                  icon={MessageSquare}
                  title="Die Unterhaltung beginnt hier"
                >
                  Teile den aktuellen Stand, eine Frage oder eine gute Idee.
                </Empty>
              )}
              {comments.map((c) => (
                <div className="comment-item" key={c.id}>
                  <Avatar user={c.User} />
                  <div>
                    <div>
                      <strong>{c.User?.name}</strong>
                      <time>{dateTime(c.createdAt)}</time>
                    </div>
                    <p>{c.body}</p>
                  </div>
                </div>
              ))}
              {canEdit && (
                <form className="comment-form" onSubmit={addComment}>
                  <Avatar user={user} />
                  <div>
                    <textarea
                      required
                      maxLength={5000}
                      rows={3}
                      placeholder="Ein Update oder einen Kommentar schreiben …"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      aria-label="Kommentar"
                    />
                    <button
                      className="button primary"
                      disabled={busy || !comment.trim()}
                    >
                      {busy ? <Spinner /> : "Kommentar senden"}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
function MembersModal({ project, members, onClose, onChanged, notify }) {
  const [invitations, setInvitations] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState("");
  const owner = project.myRole === "owner";
  const load = () =>
    owner
      ? api(`/projects/${project.id}/invitations`).then(setInvitations)
      : Promise.resolve();
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [project.id]);
  async function invite(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await api(`/projects/${project.id}/invitations`, {
        method: "POST",
        body: { email: f.get("email"), role: f.get("role") },
      });
      setLink(r.url);
      await load();
      notify("Einladungslink erstellt");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function change(id, role) {
    try {
      await api(`/projects/${project.id}/members/${id}`, {
        method: "PATCH",
        body: { role },
      });
      await onChanged();
      notify("Berechtigung gespeichert");
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(id) {
    try {
      await api(`/projects/${project.id}/members/${id}`, { method: "DELETE" });
      await onChanged();
      notify("Mitglied entfernt");
    } catch (e) {
      setError(e.message);
    }
  }
  async function revoke(id) {
    try {
      await api(`/projects/${project.id}/invitations/${id}`, {
        method: "DELETE",
      });
      await load();
      setLink("");
      notify("Einladung zurückgezogen");
    } catch (e) {
      setError(e.message);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      notify("Einladungslink kopiert");
    } catch {
      notify("Bitte kopiere den Link aus dem Textfeld.", true);
    }
  }
  return (
    <Modal
      title="Gemeinsam mehr bewegen."
      subtitle={`Team & Einladungen für ${project.name}`}
      onClose={onClose}
    >
      <FormError error={error} />
      {owner && (
        <>
          <form onSubmit={invite}>
            <label>
              E-Mail-Adresse
              <input
                name="email"
                type="email"
                required
                placeholder="kollege@unternehmen.de"
                maxLength={190}
              />
            </label>
            <div className="invite-form-bottom">
              <label>
                Berechtigung
                <select name="role">
                  <option value="editor">Kann bearbeiten</option>
                  <option value="viewer">Kann lesen</option>
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <Spinner />
                ) : (
                  <>
                    <Link size={16} />
                    Einladungslink erstellen
                  </>
                )}
              </button>
            </div>
            <p className="form-note">
              Der Link gilt 7 Tage. Teile ihn persönlich mit der eingeladenen
              Person; es wird keine E-Mail versendet.
            </p>
          </form>
          {link && (
            <div className="generated-link">
              <CheckCircle2 size={18} />
              <div>
                <strong>Bereit zum Teilen</strong>
                <input
                  readOnly
                  value={link}
                  aria-label="Einladungslink"
                  onClick={(e) => e.target.select()}
                />
              </div>
              <button
                className="icon-button"
                aria-label="Einladungslink kopieren"
                onClick={copy}
              >
                <Copy size={18} />
              </button>
            </div>
          )}
        </>
      )}
      <div className="section-heading compact">
        <h3>
          Projektmitglieder{" "}
          <span className="number-badge">{members.length}</span>
        </h3>
      </div>
      {members.map((m) => (
        <div className="member-row" key={m.id}>
          <Avatar user={m} />
          <div>
            <strong>
              {m.name}
              {m.disabled ? " (deaktiviert)" : ""}
            </strong>
            <span>{m.email}</span>
          </div>
          {owner && m.projectRole !== "owner" ? (
            <>
              <select
                aria-label={`Berechtigung für ${m.name}`}
                value={m.projectRole}
                onChange={(e) => change(m.id, e.target.value)}
              >
                <option value="editor">Bearbeiten</option>
                <option value="viewer">Lesen</option>
              </select>
              <button
                className="icon-button"
                title="Mitglied entfernen"
                aria-label={`${m.name} entfernen`}
                onClick={() => remove(m.id)}
              >
                <X size={16} />
              </button>
            </>
          ) : (
            <span className="badge gray">{roleNames[m.projectRole]}</span>
          )}
        </div>
      ))}
      {owner && invitations.length > 0 && (
        <>
          <div className="section-heading compact">
            <h3>Offene Einladungen</h3>
          </div>
          {invitations.map((i) => (
            <div className="invitation-row" key={i.id}>
              <span className="invitation-mail">
                <Mail size={17} />
              </span>
              <div>
                <strong>{i.email}</strong>
                <span>
                  {roleNames[i.role]} · gültig bis {dateTime(i.expiresAt)}
                </span>
              </div>
              <button
                className="icon-button"
                aria-label={`Einladung an ${i.email} zurückziehen`}
                onClick={() => revoke(i.id)}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Modal>
  );
}
function Admin({ user, notify, onUpdate }) {
  const [tab, setTab] = useState("auth"),
    [config, setConfig] = useState(null),
    [users, setUsers] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [message, setMessage] = useState(""),
    [userModal, setUserModal] = useState(null);
  const loadUsers = () => api("/admin/users").then(setUsers);
  useEffect(() => {
    Promise.all([api("/admin/auth").then(setConfig), loadUsers()]).catch((e) =>
      setError(e.message),
    );
  }, []);
  function update(section, key, value) {
    setConfig((c) => ({ ...c, [section]: { ...c[section], [key]: value } }));
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/admin/auth", { method: "PUT", body: config });
      setConfig(await api("/admin/auth"));
      notify("Anmeldekonfiguration gespeichert");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setTesting(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/admin/auth/test", {
        method: "POST",
        body: config,
      });
      setMessage(result.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="page-content admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ARBEITSBEREICH VERWALTEN</span>
          <h1>Administration</h1>
          <p>Ein sicherer Zugang für dein Team.</p>
        </div>
        <span className="admin-badge">
          <Shield size={15} />
          Administrator
        </span>
      </div>
      <div className="admin-tabs">
        <button
          className={tab === "auth" ? "active" : ""}
          onClick={() => setTab("auth")}
        >
          <Lock size={16} />
          Anmeldung
        </button>
        <button
          className={tab === "users" ? "active" : ""}
          onClick={() => setTab("users")}
        >
          <Users size={16} />
          Benutzer <span>{users.length}</span>
        </button>
      </div>
      <FormError error={error} />
      {tab === "auth" &&
        (!config ? (
          <Spinner />
        ) : (
          <form className="settings-card" onSubmit={save}>
            <div className="section-heading">
              <h2>Anmeldeanbieter</h2>
              <p>Verbinde euren Identitätsanbieter mit Projektwerk.</p>
            </div>
            <div className="provider-options">
              {[
                {
                  key: "local",
                  title: "Lokales Konto",
                  description: "Konten in Projektwerk",
                  Icon: Lock,
                },
                {
                  key: "oidc",
                  title: "OpenID Connect",
                  description: "Entra ID, Keycloak & mehr",
                  Icon: Shield,
                },
                {
                  key: "ldap",
                  title: "Active Directory",
                  description: "LDAP über eine TLS-Verbindung",
                  Icon: Users,
                },
              ].map(({ key, title, description, Icon }) => (
                <label
                  className={`provider-option ${config.provider === key ? "active" : ""}`}
                  key={key}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={key}
                    checked={config.provider === key}
                    onChange={() => setConfig({ ...config, provider: key })}
                  />
                  <Icon size={22} />
                  <strong>{title}</strong>
                  <span>{description}</span>
                </label>
              ))}
            </div>
            {config.provider === "local" && (
              <div className="settings-info">
                <Shield size={20} />
                <p>
                  Lokale Konten erhalten ein persönliches Passwort. Neue Konten
                  kannst du hier anlegen oder über eine Projekteinladung
                  erstellen lassen.
                </p>
              </div>
            )}
            {config.provider === "oidc" && (
              <>
                <div className="form-grid">
                  <label>
                    Anzeigename
                    <input
                      value={config.oidc.name || ""}
                      onChange={(e) => update("oidc", "name", e.target.value)}
                      placeholder="Mit Microsoft anmelden"
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Issuer-URL
                    <input
                      value={config.oidc.issuer || ""}
                      onChange={(e) => update("oidc", "issuer", e.target.value)}
                      type="url"
                      required
                      placeholder="https://login.microsoftonline.com/TENANT/v2.0"
                    />
                  </label>
                  <label>
                    Client-ID
                    <input
                      value={config.oidc.clientId || ""}
                      onChange={(e) =>
                        update("oidc", "clientId", e.target.value)
                      }
                      required
                      placeholder="ID der registrierten Anwendung"
                    />
                  </label>
                  <label>
                    Client-Secret
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={config.oidc.secret || ""}
                      onChange={(e) => update("oidc", "secret", e.target.value)}
                      placeholder={
                        config.oidc.hasSecret
                          ? "Gespeichert – leer lassen zum Beibehalten"
                          : "Geheimer Clientschlüssel"
                      }
                    />
                  </label>
                </div>
                <label>
                  Redirect-URI
                  <div className="readonly-url">
                    <input value={config.callbackUrl} readOnly />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Redirect-URI kopieren"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            config.callbackUrl,
                          );
                          notify("Redirect-URI kopiert");
                        } catch {
                          notify(
                            "Bitte kopiere die URI aus dem Textfeld.",
                            true,
                          );
                        }
                      }}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  <span className="field-note">
                    Diese Adresse beim Identitätsanbieter als Web-Redirect-URI
                    registrieren.
                  </span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.oidc.trustEmail || false}
                    onChange={(e) =>
                      update("oidc", "trustEmail", e.target.checked)
                    }
                  />
                  <span>
                    E-Mail-Claim dieses Unternehmensanbieters vertrauen
                  </span>
                </label>
                <p className="form-note">
                  Standardmäßig wird email_verified=true verlangt. Für Entra ID
                  nur aktivieren, wenn dein Tenant die E-Mail-Adressen
                  verlässlich verwaltet. Beim ersten externen Login ist ein
                  passender Einladungslink erforderlich.
                </p>
              </>
            )}
            {config.provider === "ldap" && (
              <>
                <div className="form-grid">
                  <label>
                    LDAP-Server
                    <input
                      value={config.ldap.url || ""}
                      onChange={(e) => update("ldap", "url", e.target.value)}
                      required
                      placeholder="ldaps://dc.unternehmen.local:636"
                    />
                  </label>
                  <label>
                    Base-DN
                    <input
                      value={config.ldap.baseDn || ""}
                      onChange={(e) => update("ldap", "baseDn", e.target.value)}
                      required
                      placeholder="DC=unternehmen,DC=local"
                    />
                  </label>
                  <label>
                    Bind-DN / Servicekonto
                    <input
                      value={config.ldap.bindDn || ""}
                      onChange={(e) => update("ldap", "bindDn", e.target.value)}
                      required
                      placeholder="CN=projektwerk,OU=Service,DC=unternehmen,DC=local"
                    />
                  </label>
                  <label>
                    Bind-Passwort
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={config.ldap.bindPassword || ""}
                      onChange={(e) =>
                        update("ldap", "bindPassword", e.target.value)
                      }
                      placeholder={
                        config.ldap.hasPassword
                          ? "Gespeichert – leer lassen zum Beibehalten"
                          : "Passwort des Servicekontos"
                      }
                    />
                  </label>
                </div>
                <label>
                  Benutzersuchfilter
                  <input
                    value={
                      config.ldap.filter ||
                      "(&(objectClass=user)(sAMAccountName={username}))"
                    }
                    onChange={(e) => update("ldap", "filter", e.target.value)}
                    required
                  />
                  <span className="field-note">
                    {"{username}"} wird durch den sicher maskierten
                    Benutzernamen ersetzt.
                  </span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.ldap.startTls || false}
                    onChange={(e) =>
                      update("ldap", "startTls", e.target.checked)
                    }
                  />
                  StartTLS verwenden (für ldap://)
                </label>
                <p className="form-note">
                  Die Verbindung prüft Serverzertifikate. Das Verzeichniskonto
                  benötigt eine E-Mail-Adresse. Der erste Login erfolgt über
                  eine passende Projekteinladung.
                </p>
              </>
            )}
            <div className="settings-info subtle">
              <Lock size={17} />
              <p>
                Lokale Konten bleiben zur Anmeldung verfügbar. Secrets werden
                verschlüsselt gespeichert und nicht an den Browser
                zurückgegeben.
              </p>
            </div>
            {message && (
              <div className="test-success" role="status">
                <CheckCircle2 size={18} />
                {message}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={testing || busy}
                onClick={test}
              >
                {testing ? <Spinner /> : <RefreshCw size={16} />}Verbindung
                prüfen
              </button>
              <button className="button primary" disabled={testing || busy}>
                {busy ? <Spinner /> : <Check size={16} />}Konfiguration
                speichern
              </button>
            </div>
          </form>
        ))}
      {tab === "users" && (
        <div className="settings-card">
          <div className="section-heading inline">
            <div>
              <h2>Benutzerverwaltung</h2>
              <p>Konten, Rollen und Zugriffe verwalten.</p>
            </div>
            <button className="button primary" onClick={() => setUserModal({})}>
              <Plus size={16} />
              Benutzer anlegen
            </button>
          </div>
          <div className="table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Benutzer</th>
                  <th>Rolle</th>
                  <th>Anmeldung</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="table-user">
                        <Avatar user={u} />
                        <div>
                          <strong>
                            {u.name}
                            {u.id === user.id ? " (du)" : ""}
                          </strong>
                          <small>{u.email}</small>
                        </div>
                      </div>
                    </td>
                    <td>{u.role === "admin" ? "Administrator" : "Mitglied"}</td>
                    <td>
                      {u.authType === "local"
                        ? "Lokal"
                        : u.authType === "ldap"
                          ? "Active Directory"
                          : "OpenID Connect"}
                    </td>
                    <td>
                      <span
                        className={`badge ${u.disabled ? "gray" : "green"}`}
                      >
                        {u.disabled ? "Deaktiviert" : "Aktiv"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`${u.name} bearbeiten`}
                        onClick={() => setUserModal(u)}
                      >
                        <Settings size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {userModal && (
        <UserModal
          editedUser={userModal}
          currentUser={user}
          onClose={() => setUserModal(null)}
          onSaved={async () => {
            setUserModal(null);
            await loadUsers();
            await onUpdate();
            notify("Benutzer gespeichert");
          }}
        />
      )}
    </div>
  );
}
function UserModal({ editedUser, currentUser, onClose, onSaved }) {
  const existing = Boolean(editedUser.id),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      role: f.get("role"),
      ...(existing
        ? { disabled: f.get("disabled") === "on" }
        : { email: f.get("email") }),
    };
    if (f.get("password")) body.password = f.get("password");
    try {
      await api(existing ? `/admin/users/${editedUser.id}` : "/admin/users", {
        method: existing ? "PATCH" : "POST",
        body,
      });
      await onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={existing ? "Benutzer bearbeiten" : "Benutzer anlegen"}
      subtitle="Lokale Konten und Arbeitsbereichsrechte."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label>
          Name
          <input
            name="name"
            required
            defaultValue={editedUser.name}
            maxLength={100}
          />
        </label>
        <label>
          E-Mail-Adresse
          <input
            name="email"
            type="email"
            required
            defaultValue={editedUser.email}
            disabled={existing}
            maxLength={190}
          />
        </label>
        <label>
          Rolle
          <select name="role" defaultValue={editedUser.role || "user"}>
            <option value="user">Mitglied</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        {(!existing || editedUser.authType === "local") && (
          <label>
            {existing ? "Neues Passwort (optional)" : "Passwort"}
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required={!existing}
              minLength={10}
              maxLength={72}
              placeholder={
                existing
                  ? "Leer lassen zum Beibehalten"
                  : "Mindestens 10 Zeichen"
              }
            />
          </label>
        )}
        {existing && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="disabled"
              defaultChecked={editedUser.disabled}
              disabled={currentUser.id === editedUser.id}
            />
            Konto deaktivieren
          </label>
        )}
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : "Speichern"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")).render(<App />);
