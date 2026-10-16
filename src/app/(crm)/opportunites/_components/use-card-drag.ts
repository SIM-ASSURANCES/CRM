"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

// Glisser-déposer à base d'événements « pointeur » : souris, doigt et stylet avec le même code. Le glisser natif du
// navigateur (HTML5) ne fonctionne pas au toucher et se laisse détourner par les liens et champs d'une carte.
//
// - Souris : le glissement démarre après quelques pixels de mouvement (un simple clic reste un clic).
// - Doigt / stylet : appui long (le défilement de la page reste possible tant que l'appui n'est pas « pris »).
// - Les zones de dépôt sont des éléments portant `data-drop-zone="<nom>"`.
// - Échap annule ; près des bords, les conteneurs défilants avancent tout seuls.

export type DragState<T> = { item: T; x: number; y: number };

type Options<T> = {
  enabled: boolean;
  onDrop: (item: T, zone: string) => void;
  /**
   * Glissement immédiat quel que soit le type de pointeur déclaré (appareil avec souris ou pavé tactile). Sans cela, un
   * pointeur déclaré « tactile » doit faire un appui long, et la souris qui bouge tout de suite n'attrape jamais la carte.
   */
  immediate?: boolean;
};

/** Journal de diagnostic (hors production) : `window.__cardDrag` garde les derniers événements reçus. */
function trace(message: string) {
  if (process.env.NODE_ENV === "production") return;
  const holder = window as unknown as { __cardDrag?: string[] };
  const log = (holder.__cardDrag ??= []);
  log.push(`${Math.round(performance.now())} ${message}`);
  if (log.length > 150) log.shift();
}

const MOVE_THRESHOLD = 6;
const LONG_PRESS_MS = 250;
const EDGE = 72;
const MAX_SPEED = 18;

type Gesture<T> = {
  item: T;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  timer: number | null;
  scrollTimer: number | null;
};

/** Éléments d'une carte qui gardent leur propre comportement : on ne démarre pas un glissement dessus. */
const INTERACTIVE = "select, button, input, textarea, [data-no-drag]";

function zoneAt(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  return element?.closest("[data-drop-zone]")?.getAttribute("data-drop-zone") ?? null;
}

/** Ancêtres qui défilent (la zone du tableau, la page) : candidats au défilement automatique. */
function scrollableAncestors(start: Element | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let element = start as HTMLElement | null; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    const horizontal = /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    const vertical = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    if (horizontal || vertical) found.push(element);
  }
  return found;
}

function speedFor(distanceToEdge: number): number {
  return Math.round(MAX_SPEED * Math.min(Math.max((EDGE - distanceToEdge) / EDGE, 0), 1));
}

export function useCardDrag<T>({ enabled, onDrop, immediate = false }: Options<T>) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const [overZone, setOverZone] = useState<string | null>(null);
  const onDropRef = useRef(onDrop);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onDropRef.current = onDrop;
  });
  // Démontage en plein glissement : retire les écouteurs et rend la page à la normale.
  useEffect(() => () => cleanupRef.current?.(), []);

  const startGesture = (event: ReactPointerEvent<HTMLElement>, item: T) => {
    const target = event.target as HTMLElement;
    trace(`pointerdown type=${event.pointerType} button=${event.button} cible=${target.tagName} actif=${enabled}`);
    if (!enabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (target.closest(INTERACTIVE)) return trace("ignoré : élément interactif");
    // Un glissement précédent resté ouvert (relâchement perdu hors de la fenêtre, par exemple) ne doit jamais bloquer le suivant.
    cleanupRef.current?.();

    const container = event.currentTarget;
    const gesture: Gesture<T> = {
      item,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      timer: null,
      scrollTimer: null,
    };
    // Depuis la poignée (`data-drag-handle`, avec `touch-action: none`), le glissement démarre tout de suite avec
    // n'importe quel pointeur : c'est aussi ce qui fonctionne quand la souris est traitée comme un doigt (écran étroit,
    // émulation tactile). Sur le reste de la carte, un doigt doit faire un appui long pour ne pas gêner le défilement.
    const fromHandle = target.closest("[data-drag-handle]") !== null;
    const isTouch = event.pointerType !== "mouse" && !fromHandle && !immediate;
    const scrollers = scrollableAncestors(container.parentElement);

    const activate = () => {
      if (gesture.active) return;
      gesture.active = true;
      trace("glissement activé");
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      setDrag({ item, x: gesture.x, y: gesture.y });
      setOverZone(zoneAt(gesture.x, gesture.y));
      gesture.scrollTimer = window.setInterval(() => {
        for (const scroller of scrollers) {
          const rect = scroller.getBoundingClientRect();
          if (scroller.scrollWidth > scroller.clientWidth) {
            if (gesture.x - rect.left < EDGE) scroller.scrollLeft -= speedFor(gesture.x - rect.left);
            else if (rect.right - gesture.x < EDGE) scroller.scrollLeft += speedFor(rect.right - gesture.x);
          }
          if (scroller.scrollHeight > scroller.clientHeight) {
            if (gesture.y - rect.top < EDGE) scroller.scrollTop -= speedFor(gesture.y - rect.top);
            else if (rect.bottom - gesture.y < EDGE) scroller.scrollTop += speedFor(rect.bottom - gesture.y);
          }
        }
        setOverZone(zoneAt(gesture.x, gesture.y));
      }, 16);
    };

    const finish = (drop: boolean) => {
      const wasActive = gesture.active;
      const zone = wasActive ? zoneAt(gesture.x, gesture.y) : null;
      trace(`fin dépôt=${drop} actif=${wasActive} zone=${zone}`);
      cleanup();
      if (wasActive) {
        // Le relâchement d'un glissement ne doit pas compter comme un clic sur le lien de la carte.
        const swallow = (clickEvent: MouseEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
      if (wasActive && drop && zone) onDropRef.current(item, zone);
    };

    let moves = 0;
    const onMove = (moveEvent: PointerEvent) => {
      gesture.x = moveEvent.clientX;
      gesture.y = moveEvent.clientY;
      if (moves++ === 0) trace(`premier mouvement type=${moveEvent.pointerType} buttons=${moveEvent.buttons}`);
      if (!gesture.active) {
        const moved = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);
        if (moved <= MOVE_THRESHOLD) return;
        // Au doigt, bouger avant la fin de l'appui long = l'utilisateur fait défiler : on abandonne.
        if (isTouch) {
          trace("abandon : mouvement avant l'appui long (pointeur tactile)");
          return finish(false);
        }
        activate();
      }
      setDrag({ item, x: gesture.x, y: gesture.y });
      setOverZone(zoneAt(gesture.x, gesture.y));
    };
    const onUp = () => finish(true);
    const onCancel = (cancelEvent: Event) => {
      trace(`annulé par ${cancelEvent.type}`);
      finish(false);
    };
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish(false);
    };
    // Pendant un glissement : pas de menu contextuel (appui long mobile) et pas de défilement de la page au doigt.
    const onContextMenu = (menuEvent: Event) => {
      if (gesture.active) menuEvent.preventDefault();
    };
    const onTouchMove = (touchEvent: TouchEvent) => {
      if (gesture.active && touchEvent.cancelable) touchEvent.preventDefault();
    };

    function cleanup() {
      if (gesture.timer !== null) window.clearTimeout(gesture.timer);
      if (gesture.scrollTimer !== null) window.clearInterval(gesture.scrollTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("touchmove", onTouchMove);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      cleanupRef.current = null;
      setDrag(null);
      setOverZone(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    cleanupRef.current = cleanup;

    if (isTouch) gesture.timer = window.setTimeout(activate, LONG_PRESS_MS);
  };

  return { drag, overZone, startGesture };
}
