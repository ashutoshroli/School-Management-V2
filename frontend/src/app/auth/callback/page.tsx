"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");

    if (token) {
      // Store token and fetch user profile
      localStorage.setItem("token", token);

      api
        .get("/auth/profile", {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => {
          const user = res.data.data;
          setAuth(user, token);
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
