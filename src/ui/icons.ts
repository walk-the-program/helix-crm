/**
 * The icon set. One library, one weight per context, one import path.
 *
 * Phosphor replaces Lucide everywhere (docs/DESIGN.md §10). Lucide's hairline
 * 2px strokes look like a web app; Phosphor's regular weight sits at the same
 * optical weight as the glyphs in a native macOS toolbar.
 *
 * Rules the whole product follows:
 *   - `weight="regular"` at 18px in lists, nav rows, timelines and empty
 *     states; `weight="bold"` at 16px inside a button or an icon button.
 *   - never two weights in one cluster, and never two sizes in one row;
 *   - an icon never appears without a label unless it is an `IconButton`,
 *     which carries `aria-label` and `title`;
 *   - decorative icons take `aria-hidden`.
 *
 * Every name a feature used to import from `lucide-react` is exported here
 * under the same spelling, so migrating a file was a one-line change:
 *
 *     -import { Users, Phone, Trash2 } from "lucide-react";
 *     +import { Users, Phone, Trash2 } from "@/ui/icons";
 *
 * The conceptual names (`Envelope`, `ChatText`, `Trash`, `Kanban`, …) are
 * exported alongside them and are what new code should use.
 */
import {
  Alarm,
  Archive,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  ArrowsLeftRight,
  ArrowUp,
  ArrowUUpLeft,
  Article,
  Bookmark,
  Buildings,
  CalendarBlank,
  CalendarDots,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretUpDown,
  ChartBar,
  ChatText,
  Check,
  CheckCircle,
  CircleNotch,
  ClipboardText,
  Clock,
  ClockCounterClockwise,
  Copy,
  Cpu,
  Database,
  DotsSixVertical,
  DownloadSimple,
  Envelope,
  Eye,
  FileText,
  FileXls,
  FolderOpen,
  Funnel,
  Gear,
  GearSix,
  Globe,
  Handshake,
  HardDrives,
  Info,
  Kanban,
  Key,
  Keyboard,
  LinkBreak,
  ListChecks,
  ListDashes,
  MagicWand,
  MagnifyingGlass,
  MapPin,
  Minus,
  MoonStars,
  Note,
  Package,
  Palette,
  Paperclip,
  PencilSimple,
  PencilSimpleLine,
  Phone,
  PhoneCall,
  Plus,
  Prohibit,
  PushPin,
  PushPinSlash,
  Scroll,
  SlidersHorizontal,
  Sparkle,
  Stack,
  Star,
  Stethoscope,
  Sun,
  Table,
  Tag,
  TextT,
  Trash,
  Tray,
  UploadSimple,
  User,
  UserPlus,
  Users,
  Warning,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

/* -------------------------------------------------------------------------- */
/* sizes and weights: the two numbers and the two weights, named              */
/* -------------------------------------------------------------------------- */

/** 18px regular: lists, nav rows, timelines, empty states, page headers. */
export const ICON_SIZE = 18;

/** 16px bold: inside a button, an icon button or a menu item. */
export const ICON_SIZE_SM = 16;

/** The list weight. */
export const ICON_WEIGHT = "regular" as const;

/** The button weight. Bold at 16px matches the label's optical weight. */
export const ICON_WEIGHT_STRONG = "bold" as const;

/* -------------------------------------------------------------------------- */
/* the conceptual set: what new code imports                                  */
/* -------------------------------------------------------------------------- */

export {
  /* records and people */
  Users,
  User,
  UserPlus,
  Buildings,
  Handshake,
  /* navigation and screens */
  Kanban,
  ListChecks,
  ListDashes,
  ChartBar,
  Table,
  Stack,
  Gear,
  GearSix,
  SlidersHorizontal,
  MagnifyingGlass,
  Funnel,
  /* contact methods */
  Phone,
  PhoneCall,
  Envelope,
  MapPin,
  ChatText,
  Globe,
  /* actions */
  Plus,
  Check,
  CheckCircle,
  X,
  Minus,
  Trash,
  Copy,
  ClipboardText,
  PencilSimple,
  PencilSimpleLine,
  DownloadSimple,
  UploadSimple,
  Archive,
  ArrowsClockwise,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowUUpLeft,
  Eye,
  PushPin,
  PushPinSlash,
  Bookmark,
  Star,
  Tag,
  MagicWand,
  Sparkle,
  /* direction */
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowsLeftRight,
  CaretUp,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUpDown,
  /* time */
  Clock,
  ClockCounterClockwise,
  Alarm,
  CalendarBlank,
  CalendarDots,
  /* files and data */
  FileText,
  FileXls,
  FolderOpen,
  Paperclip,
  Package,
  Database,
  HardDrives,
  Note,
  Scroll,
  Article,
  /* state and system */
  Info,
  Warning,
  WarningCircle,
  Prohibit,
  CircleNotch,
  Key,
  Keyboard,
  Cpu,
  Palette,
  TextT,
  Sun,
  MoonStars,
  Stethoscope,
  LinkBreak,
  DotsSixVertical,
  Tray,
};

/* -------------------------------------------------------------------------- */
/* the migration map: every Lucide name the product used, same spelling       */
/*                                                                            */
/* A feature changed `from "lucide-react"` to `from "@/ui/icons"` and nothing */
/* else. src/features is now clear of the old names; these aliases stay only  */
/* in case an old branch or doc still references one.                        */
/* -------------------------------------------------------------------------- */

export {
  Alarm as AlarmClock,
  WarningCircle as AlertCircle,
  Warning as AlertTriangle,
  Warning as TriangleAlert,
  Archive as ArchiveRestore,
  ArrowsLeftRight as ArrowLeftRight,
  ArrowsLeftRight as ArrowRightLeft,
  Prohibit as Ban,
  ChartBar as BarChart3,
  Package as Box,
  Buildings as Building2,
  CalendarDots as CalendarClock,
  CalendarBlank as CalendarDays,
  CheckCircle as CheckCircle2,
  CaretDown as ChevronDown,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CaretUp as ChevronUp,
  CaretUpDown as ChevronsUpDown,
  ClipboardText as ClipboardCopy,
  Database as DatabaseBackup,
  Database as DatabaseZap,
  DownloadSimple as Download,
  FileXls as FileSpreadsheet,
  DotsSixVertical as GripVertical,
  HardDrives as HardDriveDownload,
  ClockCounterClockwise as History,
  Tray as Inbox,
  Key as KeyRound,
  Kanban as KanbanSquare,
  Stack as Layers,
  ListDashes as LayoutList,
  LinkBreak as Link2Off,
  ListChecks as ListTodo,
  CircleNotch as Loader2,
  Envelope as Mail,
  ChatText as MessageSquare,
  MoonStars as MoonStar,
  PencilSimpleLine as PenLine,
  PencilSimple as Pencil,
  PushPin as Pin,
  PushPinSlash as PinOff,
  ArrowsClockwise as RefreshCw,
  ArrowCounterClockwise as RotateCcw,
  Scroll as ScrollText,
  MagnifyingGlass as Search,
  Gear as Settings,
  SlidersHorizontal as Settings2,
  Note as StickyNote,
  Table as Table2,
  Trash as Trash2,
  ArrowUUpLeft as Undo2,
  UploadSimple as Upload,
  MagicWand as Wand2,
  TextT as Type,
};

/* -------------------------------------------------------------------------- */
/* the icon type features can annotate against                                */
/* -------------------------------------------------------------------------- */

export type { Icon as IconType } from "@phosphor-icons/react";
