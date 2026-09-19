import { toast as sonnerToast } from "sonner";
import type { ExternalToast } from "sonner";

/**
 * A toast carries a sentence in the past tense — "Deleted 1 contact" — and an
 * Undo for the ten seconds it lives (docs/DESIGN.md section 9).
 *
 * Errors do not auto-dismiss at all, and they carry "Copy details": the owner
 * is often offline in a truck and the only way to get the detail to someone is
 * to paste it somewhere.
 */
export const toast = {
  success(msg: string, opts?: ExternalToast) {
    return sonnerToast.success(msg, opts);
  },

  error(msg: string, opts?: ExternalToast & { details?: string }) {
    const { details, ...rest } = opts ?? {};
    return sonnerToast.error(msg, {
      duration: Number.POSITIVE_INFINITY,
      ...(details
        ? {
            action: {
              label: "Copy details",
              onClick: () => {
                void navigator.clipboard?.writeText(details);
              },
            },
          }
        : {}),
      ...rest,
    });
  },

  info(msg: string, opts?: ExternalToast) {
    return sonnerToast.info(msg, opts);
  },

  undo(msg: string, onUndo: () => void, opts?: { duration?: number }) {
    return sonnerToast(msg, {
      duration: opts?.duration ?? 10000,
      action: {
        label: "Undo",
        onClick: () => onUndo(),
      },
    });
  },
};
