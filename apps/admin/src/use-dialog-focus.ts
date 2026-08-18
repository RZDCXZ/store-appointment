import { useEffect, useRef } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useDialogFocus<T extends HTMLElement>(): React.RefObject<T | null> {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus =
      dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    initialFocus?.focus();

    return () => previousFocus?.focus();
  }, []);

  return dialogRef;
}
