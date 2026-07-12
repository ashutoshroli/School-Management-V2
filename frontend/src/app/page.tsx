"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, FileSearch, Wallet, Briefcase, Bell, LogIn, ClipboardList } from "lucide-react";

/**
 * Public landing page - previously this route just silently redirected
 * into /dashboard or /auth/login with no content of its own, so there
 * was no public-facing "front door" for a visitor who isn't already a
 * logged-in user. Still redirects an already-logged-in visitor straight
 * to their dashboard (unchanged behavior for staff/students/parents
 * bookmarking "/"), but an ANONYMOUS visitor now sees an actual landing
 * page with quick links into every public-portal feature instead of
 * bouncing straight to the login form.
 */
export default function Home() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      router.push("/dashboard");
    } else {
      setCheckingAuth(false);
    }
  }, [router]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  const links = [
    { href: "/admission", icon: GraduationCap, title: "Admission Inquiry", desc: "Apply for admission online", color: "text-primary-600 bg-primary-50" },
    { href: "/results", icon: FileSearch, title: "Check Result", desc: "View your exam results", color: "text-emerald-600 bg-emerald-50" },
    { href: "/pay-fees", icon: Wallet, title: "Pay Fees", desc: "Check dues & pay online", color: "text-amber-600 bg-amber-50" },
    { href: "/careers", icon: Briefcase, title: "Careers", desc: "See open job vacancies", color: "text-purple-600 bg-purple-50" },
    { href: "/notices", icon: Bell, title: "Notices", desc: "Latest school announcements", color: "text-rose-600 bg-rose-50" },
    { href: "/auth/login", icon: LogIn, title: "Staff / Student Login", desc: "Access your portal", color: "text-gray-700 bg-gray-100" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100">
      <header className="max-w-5xl mx-auto px-4 py-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mb-4">
          <ClipboardList className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">School ERP</h1>
        <p className="text-gray-500 mt-2">Everything you need - admissions, results, fees, careers, and school notices - all in one place.</p>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="card hover:shadow-md transition-shadow flex flex-col items-start gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${l.color}`}>
                <l.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{l.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{l.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-gray-400 pb-8">
        &copy; {new Date().getFullYear()} School ERP. All rights reserved.
      </footer>
    </div>
  );
}
