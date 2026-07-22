import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "School ERP - Management System",
  description: "Complete School ERP with multi-branch support",
  // PWA (spec Section 1 - "Responsive, PWA-based application, mobile
  // -first"). manifest.json + theme-color let a mobile browser offer
  // "Add to Home Screen" / install as a standalone app; the actual
  // offline-shell service worker is registered client-side (see
  // ServiceWorkerRegistration below) since navigator.serviceWorker
  // registration must run in the browser, not during server rendering.
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
