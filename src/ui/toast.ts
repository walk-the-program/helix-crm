import { toast as sonnerToast } from "sonner";
import type { ExternalToast } from "sonner";

export const toast = {
  success(msg: string, opts?: ExternalToast) {
    return sonnerToast.success(msg, opts);
  },
  error(msg: string, opts?: ExternalToast) {
    return sonnerToast.error(msg, opts);
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
