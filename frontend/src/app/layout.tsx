import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import ToastProvider from "@/components/ui/ToastProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "School ERP - Management System",
  description: "Complete School ERP with multi-branch support",
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
        <ToastProvider />
      </body>
    </html>
  );
}
