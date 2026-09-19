/**
 * The settings index. One list, used by the overview grid and by the section
 * rail on every settings screen, so the two can never disagree.
 *
 * Three rows point at screens other feature agents own ("/settings/site",
 * "/backups", "/trash"). They are linked, never registered here.
 */
import type { ComponentType } from "react";
import {
  Building2,
  Clock,
  Cpu,
  Globe,
  Keyboard,
  Layers,
  Palette,
  Stethoscope,
  Tag,
  Trash2,
  Type,
} from "lucide-react";

export type SettingsSection = {
  id: string;
  title: string;
  /** One line, in the owner's words, saying what the screen is for. */
  description: string;
  to: string;
  icon: ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean }>;
  /** True when another feature owns the route: linked, not registered here. */
  external?: boolean;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "workspace",
    title: "Workspace",
    description: "The business name, currency, date format and phone region.",
    to: "/settings/workspace",
    icon: Building2,
  },
  {
    id: "vocabulary",
    title: "Vocabulary",
    description: "Call them deals, jobs or quotes. Labels only; nothing moves.",
    to: "/settings/vocabulary",
    icon: Type,
  },
  {
    id: "stages",
    title: "Stages",
    description: "Rename, reorder and recolour the columns on the pipeline.",
    to: "/pipeline",
    icon: Layers,
    external: true,
  },
  {
    id: "tags",
    title: "Tags",
    description: "The labels you put on people, companies and deals.",
    to: "/settings/tags",
    icon: Tag,
  },
  {
    id: "fields",
    title: "Custom fields",
    description: "Extra fields on a contact, company or deal.",
    to: "/settings/fields",
    icon: Layers,
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Light or dark, and how much fits on the screen.",
    to: "/settings/appearance",
    icon: Palette,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    description: "Every key this app answers to. Also opens with ?.",
    to: "/settings/shortcuts",
    icon: Keyboard,
  },
  {
    id: "workspaces",
    title: "Workspaces",
    description: "One file per business. Create, rename, switch or archive.",
    to: "/settings/workspaces",
    icon: Building2,
  },
  {
    id: "site",
    title: "Website connection",
    description: "Pull quote-form leads from your ClearPath site.",
    to: "/settings/site",
    icon: Globe,
    external: true,
  },
  {
    id: "ai",
    title: "AI",
    description: "Optional, off by default, your own Anthropic key.",
    to: "/settings/ai",
    icon: Cpu,
  },
  {
    id: "backups",
    title: "Backups",
    description: "Automatic copies of this workspace, and how to restore one.",
    to: "/backups",
    icon: Clock,
    external: true,
  },
  {
    id: "trash",
    title: "Trash",
    description: "Anything deleted in the last 30 days, and how to get it back.",
    to: "/trash",
    icon: Trash2,
    external: true,
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    description: "Where your data lives, how big it is, and the log.",
    to: "/settings/diagnostics",
    icon: Stethoscope,
  },
];

/** The rail on a settings screen lists only what this feature registers. */
export const OWNED_SECTIONS = SETTINGS_SECTIONS.filter((s) => !s.external);
