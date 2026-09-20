/**
 * The smallest possible event bus, for a dialog a command has to open.
 *
 * This file used to do two jobs. It mounted a second React root on a div
 * appended to <body> — the only way a feature could keep a dialog on every
 * screen before `FeatureModule.overlays` existed — and it held `createOpener`.
 * The mounting half is gone: the shell renders every feature's `overlays`
 * inside its own providers, on every screen, so the extra roots (and the
 * providers each one had to rebuild by hand) are not needed. The shell also
 * binds every registered command's shortcut now, so the hosts do not bind keys
 * either. See `src/app/shortcuts.ts` and docs/CONTRACTS.md.
 *
 * `createOpener` is what is left, and it is still needed: a `FeatureCommand.run`
 * is a plain function with no React context, so it cannot call `setOpen` on a
 * component. It flips a subscribable boolean instead, and the component in the
 * `overlays` slot reads it through `useSyncExternalStore`.
 */

export function createOpener(): {
  open: () => void;
  close: () => void;
  subscribe: (listener: () => void) => () => void;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
} {
  let open = false;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  return {
    open: () => {
      if (open) return;
      open = true;
      publish();
    },
    close: () => {
      if (!open) return;
      open = false;
      publish();
    },
    setOpen: (next: boolean) => {
      if (open === next) return;
      open = next;
      publish();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOpen: () => open,
  };
}
