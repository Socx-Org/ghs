import { createContext } from "react";
import type { ToastVariant } from "./Toast";

export interface ToastOptions {
  variant: ToastVariant;
  title?: string;
  message: string;
  /** ms before auto-dismiss; 0 disables auto-dismiss. Default 5000. */
  duration?: number;
}

export interface ToastContextValue {
  show: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
