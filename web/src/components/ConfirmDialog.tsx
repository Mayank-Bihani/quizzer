import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  danger?: boolean;
  children: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  danger = false,
  children,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="scrim scrim--portal"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <section
        className="dlg dlg--portal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 className="h2" id={titleId}>
          {title}
        </h2>
        <div className="stack">{children}</div>
        <div className="dlg__actions">
          <button
            ref={cancelRef}
            className="btn sec"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Keep quiz
          </button>
          <button
            className={`btn${danger ? " danger" : ""}`}
            type="button"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
