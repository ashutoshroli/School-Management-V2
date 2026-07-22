"use client";

import { useEffect } from "react";

/**
 * Registers the hand-written offline-shell service worker (see
 * public/sw.js's doc comment for exactly what it does and doesn't
 * cache) - client-component-only since `navigator.serviceWorker` only
 * exists in the browser, never during Next.js server rendering.
 * Fails silently (no UI, just a console warning) on any browser
 * without service worker support, or if registration errors for any
 * other reason - a missing PWA capability should never break the app
 * itself.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    });
  }, []);

  return null;
}
