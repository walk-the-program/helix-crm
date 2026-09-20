/**
 * The settings index. One list, in four groups, used by the index screen and by
 * the section navigation on every settings screen, so the two can never
 * disagree.
 *
 * macOS System Settings is the model: a list of sections on the left, grouped
 * under 11px labels, and one detail pane on the right. The groups here are the
 * same four the index draws, in the same order.
 *
 * Two rows still point at screens other features own and are linked, never
 * registered: "/pipeline" (stages, records) and "/trash" (records). Website
 * connection and Backups are mounted under "/settings" by this feature — see
 * the route table in ../index.tsx.
 */
import type { IconType } from "@/ui/icons";
import {
  Buildings,
  ClockCounterClockwise,
  Cpu,
  Database,
  Globe,
  Keyboard,
  Layers,
  Palette,
  SlidersHorizontal,
  Stethoscope,
  Tag,
  Trash2,
  Type,
} from "@/ui/icons";

export type SettingsGroupId = "general" | "records" | "data" | "advanced";

export type SettingsSection = {
  id: string;
  title: string;
  /** One line, in the owner's words, saying what the screen is for. */
  description: string;
  to: string;
  icon: IconType;
  /** Which group the row sits in, on the index and in the section navigation. */
  group: SettingsGroupId;
  /** True when another feature owns the route: linked, never registered here. */
  external?: boolean;
};

/** The group labels, in the order both the index and the nav draw them. */
export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "records", label: "Your records" },
  { id: "data", label: "Data" },
  { id: "advanced", label: "Advanced" },
];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "workspace",
    title: "Workspace",
    description: "The business name, currency, date format and phone region.",
    to: "/settings/workspace",
    icon: Buildings,
    group: "general",
  },
  {
    id: "vocabulary",
    title: "Vocabulary",
    description: "Call them deals, jobs or quotes. Labels only; nothing moves.",
    to: "/settings/vocabulary",
    icon: Type,
    group: "general",
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Light or dark, and how much fits on the screen.",
    to: "/settings/appearance",
    icon: Palette,
    group: "general",
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    description: "Every key this app answers to. Also opens with ?.",
    to: "/settings/shortcuts",
    icon: Keyboard,
    group: "general",
  },
  {
    id: "stages",
    title: "Stages",
    description: "Rename, reorder and recolour the columns on the pipeline.",
    to: "/pipeline",
    icon: Layers,
    group: "records",
    external: true,
  },
  {
    id: "tags",
    title: "Tags",
    description: "The labels you put on people, companies and deals.",
    to: "/settings/tags",
    icon: Tag,
    group: "records",
  },
  {
    id: "fields",
    title: "Custom fields",
    description: "Extra fields on a contact, company or deal.",
    to: "/settings/fields",
    icon: SlidersHorizontal,
    group: "records",
  },
  {
    id: "site",
    title: "Website connection",
    description: "Pull quote-form leads from your ClearPath site.",
    to: "/settings/site",
    icon: Globe,
    group: "data",
  },
  {
    id: "backups",
    title: "Backups",
    description: "Automatic copies of this workspace, and how to restore one.",
    to: "/settings/backups",
    icon: ClockCounterClockwise,
    group: "data",
  },
  {
    id: "trash",
    title: "Trash",
    description: "Anything deleted in the last 30 days, and how to get it back.",
    to: "/trash",
    icon: Trash2,
    group: "data",
    external: true,
  },
  {
    id: "ai",
    title: "AI",
    description: "Optional, off by default, your own Anthropic key.",
    to: "/settings/ai",
    icon: Cpu,
    group: "advanced",
  },
  {
    id: "workspaces",
    title: "Workspaces",
    description: "One file per business. Create, rename, switch or archive.",
    to: "/settings/workspaces",
    icon: Database,
    group: "advanced",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    description: "Where your data lives, how big it is, and the log.",
    to: "/settings/diagnostics",
    icon: Stethoscope,
    group: "advanced",
  },
];

/**
 * The same sections, bucketed by group and in group order. Both the index and
 * the section navigation render from this, which is why a row cannot appear in
 * one and be missing from the other.
 */
export function sectionsByGroup(): {
  id: SettingsGroupId;
  label: string;
  sections: SettingsSection[];
}[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);
}
