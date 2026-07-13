"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuth();

  useEffect(() => {
    const accessToken = searchParams.get("accessToken");
    const refreshToken = searchParams.get("refreshToken");

    if (accessToken) {
      // Store tokens
      localStorage.setItem("token", accessToken);
      if (refreshToken) {
        localStorage.setItem("refreshToken", refreshToken);
      }

      // Fetch user profile and set auth
      api
        .get("/auth/profile", {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        .then((res) => {
          const user = res.data.data;
          setAuth(user, accessToken);
          router.push("/dashboard");
        })
        .catch(() => {
          router.push("/auth/login");
        });
    } else {
      router.push("/auth/login");
    }
  }, [searchParams, router, setAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full mx-auto"></div>
        <p className="mt-4 text-gray-600">Authenticating...</p>
      </div>
    </div>
  );
}

/**
 * `useSearchParams()` requires a Suspense boundary in Next.js App Router
 * (it opts the enclosing tree out of static rendering) - without this
 * wrapper, `next build` fails to prerender this route entirely. The
 * fallback UI is intentionally identical to the real "Authenticating..."
 * state, since the actual searchParams read resolves essentially
 * instantly on the client.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-gray-600">Authenticating...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
