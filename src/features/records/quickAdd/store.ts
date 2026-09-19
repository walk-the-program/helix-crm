/**
 * Quick add has to be reachable from every screen, including screens this
 * feature does not own, so its open/closed state lives in a tiny module store
 * rather than in any one screen's React tree.
 */
export type QuickAddType = "contact" | "company" | "deal" | "task" | "note";

type Listener = () => void;

let open = false;
let initialType: QuickAddType = "contact";
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeQuickAdd(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function quickAddSnapshot(): boolean {
  return open;
}

export function quickAddType(): QuickAddType {
  return initialType;
}

export function openQuickAdd(type: QuickAddType = "contact"): void {
  initialType = type;
  open = true;
  emit();
}

export function closeQuickAdd(): void {
  open = false;
  emit();
}

/** Tests reset the store between renders. */
export function __resetQuickAddForTests(): void {
  open = false;
  initialType = "contact";
  listeners.clear();
}
