"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GripVertical,
  ListTodo,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  Plus,
  Undo2,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { LostOpportunityDialog } from "@/app/(crm)/opportunites/_components/lost-opportunity-dialog";
import { StageMoveDialog } from "@/app/(crm)/opportunites/_components/stage-move-dialog";
import { useCardDrag } from "@/app/(crm)/opportunites/_components/use-card-drag";
import { quickMoveStageAction } from "@/app/(crm)/opportunites/actions";
import {
  canMoveInstantly,
  daysInStageLabel,
  initials,
  moveCard,
  staleness,
  withVersion,
} from "@/features/opportunities/board";
import { STAGE_LABELS } from "@/features/opportunities/config";
import type { BoardCard, BoardData } from "@/features/opportunities/service";
import { formatDate, formatFcfa } from "@/lib/format";
import { cn } from "@/lib/utils";

type KanbanBoardProps = {
  board: BoardData;
  canWrite: boolean;
  /** Journaliser une note ou créer une tâche depuis la carte (permissions distinctes de l'écriture des opportunités). */
  canLogActivity?: boolean;
  canCreateTask?: boolean;
  qualifiedAbove: number;
  /** Chemin (avec filtres) où revenir après une action : les filtres sont conservés. */
  returnTo: string;
};

type Pending = { card: BoardCard; target: number } | null;
type Notice = { kind: "moved" | "error"; text: string; undo?: { card: BoardCard; backTo: number } } | null;
type ContactMenu = { card: BoardCard; x: number; y: number; up: boolean } | null;

const stageName = (stage: number) => STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? String(stage);

// --- Colonnes repliées : préférence PAR NAVIGATEUR (localStorage), jamais une donnée métier ---------------------------

const COLLAPSED_KEY = "crm.kanban.collapsed";
const collapsedListeners = new Set<() => void>();
let collapsedSnapshot: string | null = null;

function readCollapsed(): string {
  if (collapsedSnapshot === null) {
    try {
      collapsedSnapshot = window.localStorage.getItem(COLLAPSED_KEY) ?? "[]";
    } catch {
      collapsedSnapshot = "[]";
    }
  }
  return collapsedSnapshot;
}

function writeCollapsed(stages: number[]) {
  collapsedSnapshot = JSON.stringify(stages);
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsedSnapshot);
  } catch {
    // Stockage indisponible (navigation privée…) : la préférence vaut pour la page ouverte seulement.
  }
  collapsedListeners.forEach((listener) => listener());
}

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSED_KEY) {
      collapsedSnapshot = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    collapsedListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function useCollapsedStages(): [Set<number>, (stage: number) => void] {
  const raw = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => "[]");
  const collapsed = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : []);
    } catch {
      return new Set<number>();
    }
  }, [raw]);
  const toggle = (stage: number) => {
    const next = new Set(collapsed);
    if (!next.delete(stage)) next.add(stage);
    writeCollapsed([...next]);
  };
  return [collapsed, toggle];
}

// --- Type de pointeur : souris/pavé tactile (glisser natif du navigateur) ou doigt seulement --------------------------

const FINE_POINTER = "(any-pointer: fine)";

function subscribeFinePointer(listener: () => void) {
  const query = window.matchMedia(FINE_POINTER);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Vrai quand l'appareil a une souris ou un pavé tactile ; faux au rendu serveur (aucun glisser natif avant hydratation). */
function useFinePointer(): boolean {
  return useSyncExternalStore(subscribeFinePointer, () => window.matchMedia(FINE_POINTER).matches, () => false);
}

/**
 * Tableau Kanban façon HubSpot : une colonne par étape ouverte, des cartes riches et des déplacements fluides.
 *
 * - Glisser-déposer à la souris, au doigt (appui long) ou au stylet ; équivalent clavier : « Déplacer vers… ».
 * - Un RECUL se fait tout de suite (la carte change de colonne avant la réponse du serveur) avec un bandeau « Annuler ».
 * - Avancer, gagner ou perdre passent par la boîte de confirmation : le critère de l'étape (CDC 5.1), le contrat signé
 *   et le motif de perte sont des règles métier que le serveur impose, comme les champs obligatoires de HubSpot.
 * - Colonnes repliables, création rapide dans une étape, ancienneté dans l'étape et « Contacter » sur chaque carte.
 */
export function KanbanBoard({ board, canWrite, canLogActivity = false, canCreateTask = false, qualifiedAbove, returnTo }: KanbanBoardProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [collapsed, toggleCollapsed] = useCollapsedStages();

  // État local = optimisme ; il est remplacé par les données du serveur dès qu'elles arrivent (router.refresh).
  const [columns, setColumns] = useState(board.columns);
  const [seenBoard, setSeenBoard] = useState(board);
  if (board !== seenBoard) {
    setSeenBoard(board);
    setColumns(board.columns);
  }

  const [pending, setPending] = useState<Pending>(null);
  const [losing, setLosing] = useState<BoardCard | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [contactMenu, setContactMenu] = useState<ContactMenu>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const quickMove = (card: BoardCard, target: number, undoing = false) => {
    const before = columns;
    setColumns((current) => moveCard(current, card.id, target));
    setNotice(null);
    startTransition(async () => {
      const result = await quickMoveStageAction({
        id: card.id,
        version: card.version,
        targetStage: target,
        // Annuler un recul = revenir à une étape déjà validée : le critère est réputé rempli.
        criteriaConfirmed: undoing,
      });
      if (result.ok) {
        setColumns((current) => withVersion(current, card.id, result.version));
        setNotice({
          kind: "moved",
          text: `« ${card.name} » est maintenant à l'étape ${stageName(target)} (${target} %).`,
          undo: undoing ? undefined : { card: { ...card, stage: target, version: result.version }, backTo: card.stage },
        });
      } else {
        setColumns(before);
        if (result.needsDetails) setPending({ card, target });
        else setNotice({ kind: "error", text: result.error });
      }
      // Met à jour les indicateurs de la page (pipeline brut, pondéré…) avec les données du serveur.
      router.refresh();
    });
  };

  const requestMove = (card: BoardCard, target: number) => {
    if (target === card.stage) return;
    if (canMoveInstantly(card, target, qualifiedAbove)) quickMove(card, target);
    else setPending({ card, target });
  };

  const finePointer = useFinePointer();
  const { drag, overZone, startGesture } = useCardDrag<BoardCard>({
    enabled: canWrite,
    immediate: finePointer,
    onDrop: (card, zone) => {
      if (zone === "won") requestMove(card, 100);
      else if (zone === "lost") setLosing(card);
      else if (zone.startsWith("stage-")) requestMove(card, Number(zone.slice("stage-".length)));
    },
  });

  const closeContactMenu = useCallback(() => setContactMenu(null), []);
  const openContactMenu = (card: BoardCard, rect: DOMRect) => {
    if (contactMenu?.card.id === card.id) return setContactMenu(null);
    // Le menu s'ouvre vers le haut quand il n'a pas la place de s'afficher sous le bouton.
    const up = rect.bottom + 230 > window.innerHeight && rect.top > 230;
    setContactMenu({ card, x: Math.min(rect.left, window.innerWidth - 272), y: up ? rect.top - 4 : rect.bottom + 4, up });
  };

  const withReturn = (path: string, params: Record<string, string>) =>
    `${path}?${new URLSearchParams({ ...params, retour: returnTo }).toString()}`;

  return (
    <>
      {!canWrite && (
        <p role="note" className="mb-3 rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink-soft">
          Lecture seule : votre profil ne permet pas de déplacer les opportunités.
        </p>
      )}
      {/* Colonnes de même hauteur (et jamais minuscules) : une colonne vide doit rester facile à atteindre en déposant. */}
      {/* `relative` : les textes `sr-only` (position absolue) des cartes restent DANS cette zone défilante. Sans cela ils
          s'échappent du conteneur et font défiler horizontalement toute la page. */}
      <div className="relative flex items-stretch gap-4 overflow-x-auto pb-4" role="list" aria-label="Étapes du pipeline">
        {columns.map((column) => {
          const isCollapsed = collapsed.has(column.stage);
          const zone = `stage-${column.stage}`;
          return (
            <section
              key={column.stage}
              role="listitem"
              aria-label={`${stageName(column.stage)} (${column.stage} %)`}
              data-drop-zone={canWrite ? zone : undefined}
              className={cn(
                "flex min-h-72 flex-col rounded-2xl border bg-surface p-3 transition-colors",
                // Colonnes élastiques : elles se partagent la largeur disponible (pas de défilement horizontal tant que
                // 6 colonnes de 11 rem tiennent). Une colonne repliée garde une largeur fixe étroite.
                isCollapsed ? "w-14 shrink-0 items-center" : "min-w-44 flex-1 basis-0",
                overZone === zone ? "border-brand-500 bg-brand-50" : "border-line",
              )}
            >
              {isCollapsed ? (
                <button
                  type="button"
                  onClick={() => toggleCollapsed(column.stage)}
                  aria-expanded="false"
                  aria-label={`Déplier ${stageName(column.stage)} (${column.stage} %), ${column.totals.count} opportunité(s)`}
                  className="flex flex-col items-center gap-3 rounded-lg py-1 text-ink hover:bg-white"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-soft">{column.totals.count}</span>
                  <span className="text-sm font-semibold [writing-mode:vertical-rl]">
                    {stageName(column.stage)} <span className="text-muted">({column.stage} %)</span>
                  </span>
                </button>
              ) : (
                <>
                  <header className="mb-3 px-1">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(column.stage)}
                        aria-expanded="true"
                        aria-label={`Replier ${stageName(column.stage)} (${column.stage} %)`}
                        className="flex min-w-0 items-center gap-1 rounded-md text-sm font-semibold text-ink hover:text-brand-700"
                      >
                        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {stageName(column.stage)} <span className="font-normal text-muted">({column.stage} %)</span>
                        </span>
                      </button>
                      <span className="flex items-center gap-1.5">
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-soft">{column.totals.count}</span>
                        {canWrite && (
                          <Link
                            href={`/opportunites/nouveau?etape=${column.stage}`}
                            aria-label={`Créer une opportunité à l'étape ${stageName(column.stage)}`}
                            title="Créer une opportunité dans cette étape"
                            className="inline-flex size-6 items-center justify-center rounded-md text-ink-soft hover:bg-white hover:text-brand-700"
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </Link>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Brut {formatFcfa(column.totals.gross)} · Pondéré {formatFcfa(column.totals.weighted)}
                    </p>
                  </header>

                  <ul className="flex flex-1 flex-col gap-3">
                    {column.cards.length === 0 && (
                      <li className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">
                        {canWrite ? "Déposez une opportunité ici" : "Aucune opportunité"}
                      </li>
                    )}
                    {column.cards.map((card) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        columns={columns}
                        canWrite={canWrite}
                        canLogActivity={canLogActivity}
                        canCreateTask={canCreateTask}
                        noteHref={withReturn("/activites/nouveau", { compte: card.accountId, opportunite: card.id })}
                        taskHref={withReturn("/taches/nouveau", { compte: card.accountId, opportunite: card.id })}
                        dragging={drag?.item.id === card.id}
                        finePointer={finePointer}
                        menuOpen={contactMenu?.card.id === card.id}
                        onPointerDown={(event) => startGesture(event, card)}
                        onMove={(target) => requestMove(card, target)}
                        onLose={() => setLosing(card)}
                        onContact={(rect) => openContactMenu(card, rect)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })}
      </div>

      {canWrite && (
        <div className="mt-2 grid gap-4 sm:grid-cols-2" aria-label="Clôturer par glisser-déposer">
          <div
            data-drop-zone="won"
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-sm font-semibold text-emerald-800",
              overZone === "won" ? "border-emerald-500 bg-emerald-100" : "border-emerald-300 bg-emerald-50",
            )}
          >
            <CheckCircle2 className="size-5" aria-hidden="true" /> Déposer ici : gagnée
          </div>
          <div
            data-drop-zone="lost"
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-sm font-semibold text-danger",
              overZone === "lost" ? "border-danger bg-red-100" : "border-danger/40 bg-red-50",
            )}
          >
            <XCircle className="size-5" aria-hidden="true" /> Déposer ici : perdue
          </div>
        </div>
      )}

      {/* Carte « fantôme » qui suit le curseur ou le doigt pendant un glissement. */}
      {drag && (
        <div
          aria-hidden="true"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
          className="pointer-events-none fixed z-50 w-60 rotate-2 rounded-xl border border-brand-500 bg-white p-3 text-sm shadow-xl"
        >
          <p className="truncate font-semibold text-brand-700">{drag.item.name}</p>
          <p className="truncate text-xs text-ink-soft">{drag.item.accountName}</p>
          <p className="mt-1 font-semibold text-ink">{formatFcfa(drag.item.amount)}</p>
        </div>
      )}

      {contactMenu && (
        <ContactMenuPanel
          menu={contactMenu}
          canLogActivity={canLogActivity}
          canCreateTask={canCreateTask}
          noteHref={withReturn("/activites/nouveau", { compte: contactMenu.card.accountId, opportunite: contactMenu.card.id })}
          taskHref={withReturn("/taches/nouveau", { compte: contactMenu.card.accountId, opportunite: contactMenu.card.id })}
          onClose={closeContactMenu}
        />
      )}

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={cn(
            "fixed inset-x-4 bottom-6 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg",
            notice.kind === "error" ? "border-danger/40 bg-red-50 text-danger" : "border-line bg-ink text-white",
          )}
        >
          <span className="flex-1">{notice.text}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={() => notice.undo && quickMove(notice.undo.card, notice.undo.backTo, true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25"
            >
              <Undo2 className="size-4" aria-hidden="true" /> Annuler
            </button>
          )}
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Fermer le message"
            className="rounded-md p-1 hover:bg-white/15"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {pending && (
        <StageMoveDialog
          opportunity={{
            id: pending.card.id,
            version: pending.card.version,
            name: pending.card.name,
            stage: pending.card.stage,
            amount: pending.card.amount,
            productLabel: pending.card.productLabel,
          }}
          targetStage={pending.target}
          qualifiedAbove={qualifiedAbove}
          returnTo={returnTo}
          onClose={() => setPending(null)}
        />
      )}
      {losing && (
        <LostOpportunityDialog
          opportunity={{ id: losing.id, version: losing.version, name: losing.name }}
          returnTo={returnTo}
          onClose={() => setLosing(null)}
        />
      )}
    </>
  );
}

// --- Menu « Contacter » -------------------------------------------------------------------------------------------------

const menuItemClass =
  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface focus-visible:bg-surface focus-visible:outline-none";

type ContactMenuPanelProps = {
  menu: NonNullable<ContactMenu>;
  canLogActivity: boolean;
  canCreateTask: boolean;
  noteHref: string;
  taskHref: string;
  onClose: () => void;
};

/**
 * Menu des moyens de joindre le contact du dossier. Positionné en `fixed` : la colonne du tableau défile et rognerait un
 * menu positionné dans la carte. Se ferme au clic ailleurs, avec Échap, au défilement et au redimensionnement.
 */
function ContactMenuPanel({ menu, canLogActivity, canCreateTask, noteHref, taskHref, onClose }: ContactMenuPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const { card } = menu;
  const contact = card.contact;
  const whatsapp = contact?.phone ? contact.phone.replace(/\D/g, "") : null;

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("a")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      // Le bouton « Contacter » gère lui-même l'ouverture et la fermeture.
      if (!panel.current?.contains(target) && !target.closest("[data-contact-trigger]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={panel}
      role="menu"
      aria-label={`Contacter pour ${card.name}`}
      style={{ left: menu.x, top: menu.y, transform: menu.up ? "translateY(-100%)" : undefined }}
      className="fixed z-50 w-64 rounded-xl border border-line bg-white p-1.5 shadow-xl"
    >
      <p className="px-3 pb-1 pt-1.5 text-xs text-muted">{contact ? contact.name : "Aucun contact rattaché à ce dossier"}</p>

      {contact?.phone && (
        <a role="menuitem" href={`tel:${contact.phone}`} onClick={onClose} className={menuItemClass}>
          <Phone className="size-4 text-brand-700" aria-hidden="true" />
          <span className="min-w-0">
            Appeler
            <span className="block truncate text-xs text-muted">{contact.phone}</span>
          </span>
        </a>
      )}
      {whatsapp && (
        <a role="menuitem" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" onClick={onClose} className={menuItemClass}>
          <MessageCircle className="size-4 text-emerald-700" aria-hidden="true" /> WhatsApp
        </a>
      )}
      {contact?.email && (
        <a role="menuitem" href={`mailto:${contact.email}`} onClick={onClose} className={menuItemClass}>
          <Mail className="size-4 text-brand-700" aria-hidden="true" />
          <span className="min-w-0">
            Écrire un e-mail
            <span className="block truncate text-xs text-muted">{contact.email}</span>
          </span>
        </a>
      )}
      {(!contact || (!contact.phone && !contact.email)) && (
        <Link role="menuitem" href={`/opportunites/${card.id}`} onClick={onClose} className={menuItemClass}>
          <UserPlus className="size-4 text-brand-700" aria-hidden="true" />
          <span className="min-w-0">
            {contact ? "Compléter les coordonnées" : "Ajouter un contact"}
            <span className="block text-xs text-muted">Ouvre la fiche de l&apos;opportunité</span>
          </span>
        </Link>
      )}

      {(canLogActivity || canCreateTask) && <hr className="my-1 border-line" />}
      {canLogActivity && (
        <Link role="menuitem" href={noteHref} onClick={onClose} className={menuItemClass}>
          <NotebookPen className="size-4 text-ink-soft" aria-hidden="true" /> Journaliser un échange
        </Link>
      )}
      {canCreateTask && (
        <Link role="menuitem" href={taskHref} onClick={onClose} className={menuItemClass}>
          <ListTodo className="size-4 text-ink-soft" aria-hidden="true" /> Créer une tâche de relance
        </Link>
      )}
    </div>
  );
}

// --- Carte --------------------------------------------------------------------------------------------------------------

type CardItemProps = {
  card: BoardCard;
  columns: BoardData["columns"];
  canWrite: boolean;
  canLogActivity: boolean;
  canCreateTask: boolean;
  noteHref: string;
  taskHref: string;
  dragging: boolean;
  /** Appareil avec souris ou pavé tactile : la carte entière est saisissable tout de suite (sans appui long). */
  finePointer: boolean;
  menuOpen: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onMove: (target: number) => void;
  onLose: () => void;
  onContact: (rect: DOMRect) => void;
};

const iconButtonClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-soft hover:bg-surface hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500";

function CardItem({
  card,
  columns,
  canWrite,
  canLogActivity,
  canCreateTask,
  noteHref,
  taskHref,
  dragging,
  finePointer,
  menuOpen,
  onPointerDown,
  onMove,
  onLose,
  onContact,
}: CardItemProps) {
  const age = staleness(card.daysInStage);

  return (
    <li
      onPointerDown={onPointerDown}
      // Le glisser natif (liens, images) est désactivé : c'est le glissement par événements pointeur qui fait foi.
      onDragStart={(event) => event.preventDefault()}
      className={cn(
        "group select-none rounded-xl border bg-white p-3 text-sm shadow-sm transition-shadow hover:shadow-md",
        canWrite && "cursor-grab active:cursor-grabbing",
        // Souris/pavé tactile présent : le navigateur ne doit pas s'approprier le geste (défilement) à la place du glissement.
        canWrite && finePointer && "touch-none",
        card.overdue ? "border-danger/50" : "border-line",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/opportunites/${card.id}`} draggable={false} className="font-semibold text-brand-700 hover:underline">
          {card.name}
        </Link>
        {canWrite && (
          // Poignée de saisie : le glissement démarre ici tout de suite, à la souris comme au doigt (touch-none).
          <span
            data-drag-handle
            title="Glisser pour déplacer"
            className="-mr-1 -mt-1 inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:bg-surface hover:text-brand-700 active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden="true" />
            <span className="sr-only">Glisser pour déplacer {card.name}</span>
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-ink-soft">{card.accountName}</p>
      {card.contact && <p className="text-xs text-muted">{card.contact.name}</p>}

      <p className="mt-2 font-semibold text-ink">{formatFcfa(card.amount)}</p>
      <p className="text-xs text-muted">Pondéré {formatFcfa(card.weighted)}</p>

      <p className="mt-2 text-xs text-ink-soft">
        {card.nextAction}
        {card.nextActionDate && (
          <span className={cn("ml-1 inline-flex items-center gap-1", card.overdue && "font-semibold text-danger")}>
            {card.overdue && <AlertTriangle className="size-3" aria-hidden="true" />}
            {formatDate(card.nextActionDate)}
            {card.overdue && " (en retard)"}
          </span>
        )}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span
          title={card.ownerName}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[0.65rem] font-bold text-brand-800"
        >
          <span aria-hidden="true">{initials(card.ownerName)}</span>
          <span className="sr-only">Responsable : {card.ownerName}</span>
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
            age === "fresh" && "text-muted",
            age === "stale" && "bg-amber-50 font-medium text-amber-800",
            age === "very-stale" && "bg-red-50 font-semibold text-danger",
          )}
        >
          <Clock className="size-3" aria-hidden="true" />
          {daysInStageLabel(card.daysInStage)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
        <button
          type="button"
          data-contact-trigger
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Contacter pour ${card.name}`}
          onClick={(event) => onContact(event.currentTarget.getBoundingClientRect())}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-xs font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <Phone className="size-3.5" aria-hidden="true" /> Contacter <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>

        {/* Accès directs conservés sur la carte (le menu « Contacter » les regroupe aussi). */}
        {card.contact?.phone && (
          <a href={`tel:${card.contact.phone}`} className={iconButtonClass} aria-label={`Appeler ${card.contact.name}`} title="Appeler">
            <Phone className="size-4" aria-hidden="true" />
          </a>
        )}
        {card.contact?.email && (
          <a href={`mailto:${card.contact.email}`} className={iconButtonClass} aria-label={`Écrire à ${card.contact.name}`} title="Écrire un e-mail">
            <Mail className="size-4" aria-hidden="true" />
          </a>
        )}
        {canLogActivity && (
          <Link href={noteHref} draggable={false} className={iconButtonClass} aria-label={`Journaliser une activité pour ${card.name}`} title="Journaliser une activité">
            <NotebookPen className="size-4" aria-hidden="true" />
          </Link>
        )}
        {canCreateTask && (
          <Link href={taskHref} draggable={false} className={iconButtonClass} aria-label={`Créer une tâche pour ${card.name}`} title="Créer une tâche">
            <ListTodo className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Équivalent clavier et tactile du glisser-déposer. */}
      {canWrite && (
        <label className="mt-2 block text-xs text-muted">
          <span className="sr-only">Déplacer {card.name}</span>
          <select
            value=""
            aria-label={`Déplacer ${card.name}`}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "lost") onLose();
              else if (value) onMove(Number(value));
            }}
            className="h-8 w-full rounded-md border border-line bg-white px-2 text-xs text-ink"
          >
            <option value="">Déplacer vers…</option>
            {columns
              .filter((other) => other.stage !== card.stage)
              .map((other) => (
                <option key={other.stage} value={other.stage}>
                  {stageName(other.stage)} ({other.stage} %)
                </option>
              ))}
            <option value="100">Gagnée (100 %)</option>
            <option value="lost">Perdue…</option>
          </select>
        </label>
      )}
    </li>
  );
}
