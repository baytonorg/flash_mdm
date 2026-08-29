import { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

interface ModalStackEntry {
  id: symbol;
  dialog: HTMLDivElement;
  restoreTarget: HTMLElement | null;
}

const openModalStack: ModalStackEntry[] = [];
const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isTopModal(modalId: symbol) {
  return openModalStack.at(-1)?.id === modalId;
}

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  error?: string;
}

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'default',
  loading = false,
  error,
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(loading);
  const onCloseRef = useRef(onClose);
  const modalIdRef = useRef(Symbol('confirm-modal'));
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    loadingRef.current = loading;
    onCloseRef.current = onClose;
  }, [loading, onClose]);

  useEffect(() => {
    if (open && loading && isTopModal(modalIdRef.current)) dialogRef.current?.focus();
  }, [loading, open]);

  useEffect(() => {
    if (!open) return;
    const modalId = modalIdRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialogRef.current) return;
    const entry: ModalStackEntry = {
      id: modalId,
      dialog: dialogRef.current,
      restoreTarget: previouslyFocused,
    };
    openModalStack.push(entry);
    if (loadingRef.current) dialogRef.current?.focus();
    else cancelRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (!isTopModal(modalId)) return;
      if (e.key === 'Escape' && !loadingRef.current) onCloseRef.current();
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current.contains(activeElement) || activeElement === dialogRef.current) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      const entryIndex = openModalStack.findIndex((candidate) => candidate.id === modalId);
      const wasTopModal = entryIndex === openModalStack.length - 1;
      document.removeEventListener('keydown', handleKey);
      if (entryIndex < 0) return;

      for (const laterEntry of openModalStack.slice(entryIndex + 1)) {
        if (laterEntry.restoreTarget && entry.dialog.contains(laterEntry.restoreTarget)) {
          laterEntry.restoreTarget = entry.restoreTarget;
        }
      }
      openModalStack.splice(entryIndex, 1);

      if (wasTopModal) {
        const restoreTarget = entry.restoreTarget?.isConnected
          ? entry.restoreTarget
          : openModalStack.at(-1)?.dialog;
        restoreTarget?.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current && !loading) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        aria-busy={loading || undefined}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <div className="flex items-start gap-3">
          {variant === 'danger' && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10">
              <AlertTriangle className="h-5 w-5 text-danger" />
            </div>
          )}
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-gray-900">{title}</h3>
            <p id={messageId} className="mt-1 text-sm text-muted">{message}</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <span role="status" aria-live="polite" className="sr-only">
          {loading ? 'Processing' : ''}
        </span>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={clsx(
              'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50',
              variant === 'danger'
                ? 'bg-danger hover:bg-danger/90'
                : 'bg-accent hover:bg-accent-light',
            )}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
