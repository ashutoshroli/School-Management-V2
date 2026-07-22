"use client";

import { create } from "zustand";
import api from "@/lib/api";
import { AuthState, User } from "@/types";

export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string, rememberMe?: boolean) => {
    const response = await api.post("/auth/login", { email, password, rememberMe });
    const { accessToken, refreshToken, user } = response.data.data;

    localStorage.setItem("token", accessToken);
    if (refreshToken) {
      localStorage.setItem("refreshToken", refreshToken);
    }
    localStorage.setItem("user", JSON.stringify(user));

    set({ user, token: accessToken, isAuthenticated: true, isLoading: false });
  },

  loginWithGoogle: () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
    window.location.href = `${apiUrl}/auth/google`;
  },

  logout: async () => {
    const refreshToken = localStorage.getItem("refreshToken");
    
    // Try to invalidate session on server
    try {
      await api.post("/auth/logout", { refreshToken });
    } catch (e) {
      // Ignore errors - client-side logout should work regardless
    }
    
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    window.location.href = "/auth/login";
  },

  setAuth: (user: User, token: string) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    set({ user, token, isAuthenticated: true, isLoading: false });
  },
}));
