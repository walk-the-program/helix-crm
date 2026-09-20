function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  const agent = navigator.userAgent ?? "";
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(agent);
}

const SYMBOLS: Record<string, { mac: string; other: string }> = {
  mod: { mac: "⌘", other: "Ctrl" },
  cmd: { mac: "⌘", other: "Ctrl" },
  ctrl: { mac: "⌃", other: "Ctrl" },
  alt: { mac: "⌥", other: "Alt" },
  option: { mac: "⌥", other: "Alt" },
  shift: { mac: "⇧", other: "Shift" },
  enter: { mac: "⏎", other: "Enter" },
  backspace: { mac: "⌫", other: "Backspace" },
  escape: { mac: "Esc", other: "Esc" },
  esc: { mac: "Esc", other: "Esc" },
};

function formatKey(key: string, mac: boolean): string {
  const lower = key.toLowerCase();
  const symbol = SYMBOLS[lower];
  if (symbol) return mac ? symbol.mac : symbol.other;
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Shown next to the action it triggers, never on its own. */
export function Kbd(props: { keys: string }) {
  const mac = isMac();
  const parts = props.keys.split("+").map((key) => formatKey(key.trim(), mac));
  const separator = mac ? "" : "+";
  const label = parts.join(separator);

  return (
    <kbd
      className={[
        "inline-flex flex-none items-center justify-center",
        "min-w-[var(--space-5)] px-[var(--space-1)]",
        "border border-[var(--color-border)]",
        "bg-[var(--color-accent-soft)] text-[var(--color-text-faint)]",
        // family-name: is required here — the plain var() form is
        // ambiguous to Tailwind and compiles to a font-weight. macOS draws
        // shortcut glyphs in the system face, not mono.
        "font-[family-name:var(--font-sans)] text-[length:var(--text-xs)]",
        "leading-[var(--leading-tight)]",
      ].join(" ")}
    >
      {label}
    </kbd>
  );
}
