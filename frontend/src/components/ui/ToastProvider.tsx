"use client";

import { ToastContainer } from "./Toast";

/**
 * Client-side wrapper for the ToastContainer so it can be used inside
 * the root layout (which is a Server Component that exports metadata).
 */
export default function ToastProvider() {
  return <ToastContainer />;
}
