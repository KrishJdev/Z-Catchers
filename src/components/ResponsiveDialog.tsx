'use client';

import React, { useLayoutEffect, useRef, type ReactNode } from 'react';

export function ResponsiveDialog({ labelledBy, onClose, className, children }: {
  labelledBy: string;
  onClose: () => void;
  className: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      className={`fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl border border-night-border bg-night-surface text-cream-primary shadow-2xl backdrop:bg-night-bg/85 md:inset-0 md:m-auto md:rounded-2xl ${className}`}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
