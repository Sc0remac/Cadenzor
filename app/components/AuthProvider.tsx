"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthError,
  Session,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "../lib/supabaseBrowserClient";

export interface AuthProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  company: string | null;
  isAdmin: boolean;
  updatedAt: string | null;
}

interface AuthContextValue {
  supabase: SupabaseClient;
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  loading: boolean;
  signInWithPassword: (
    credentials: { email: string; password: string }
  ) => Promise<AuthError | null>;
  signUpWithPassword: (
    credentials: { email: string; password: string }
  ) => Promise<AuthError | null>;
  sendPasswordReset: (email: string) => Promise<AuthError | null>;
  signOut: () => Promise<AuthError | null>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [profileRefreshToken, setProfileRefreshToken] = useState(0);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        console.error("Failed to get current session", error);
      }

      setSession(data?.session ?? null);
      setSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
      setSessionLoading(false);
      setProfileRefreshToken((token) => token + 1);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithPassword = useCallback<
    AuthContextValue["signInWithPassword"]
  >(
    async ({ email, password }) => {
      setAuthActionLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setAuthActionLoading(false);
      return error ?? null;
    },
    [supabase]
  );

  const signUpWithPassword = useCallback<
    AuthContextValue["signUpWithPassword"]
  >(
    async ({ email, password }) => {
      setAuthActionLoading(true);
      try {
        const response = await fetch("/api/auth/sign-up", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
          let message = "Unable to create account. Please try again.";
          try {
            const body = (await response.json()) as { error?: string };
            if (body?.error) {
              message = body.error;
            }
          } catch (err) {
            console.error("Failed to parse signup error payload", err);
          }

          return { message, status: response.status } as AuthError;
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        return error ?? null;
      } catch (error) {
        console.error("Failed to complete sign up", error);
        return {
          message: "Unexpected error while creating account.",
          status: 500,
        } as AuthError;
      } finally {
        setAuthActionLoading(false);
      }
    },
    [supabase]
  );

  const sendPasswordReset = useCallback<AuthContextValue["sendPasswordReset"]>(
    async (email) => {
      setAuthActionLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/reset-password`
            : undefined,
      });
      setAuthActionLoading(false);
      return error ?? null;
    },
    [supabase]
  );

  const signOut = useCallback<AuthContextValue["signOut"]>(async () => {
    setAuthActionLoading(true);
    const { error } = await supabase.auth.signOut();
    setAuthActionLoading(false);
    return error ?? null;
  }, [supabase]);

  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      return;
    }

    setProfileLoading(true);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, company, is_admin, updated_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load profile", error);
      setProfile({
        id: userId,
        email: userEmail,
        fullName: null,
        role: null,
        company: null,
        isAdmin: false,
        updatedAt: null,
      });
      setProfileLoading(false);
      return;
    }

    setProfile({
      id: userId,
      email: data?.email ?? userEmail,
      fullName: data?.full_name ?? null,
      role: data?.role ?? null,
      company: data?.company ?? null,
      isAdmin: Boolean(data?.is_admin),
      updatedAt: data?.updated_at ?? null,
    });

    setProfileLoading(false);
  }, [supabase, userId, userEmail]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleProfileUpdated = () => {
      setProfileRefreshToken((token) => token + 1);
    };

    window.addEventListener("profile:updated", handleProfileUpdated);
    return () => window.removeEventListener("profile:updated", handleProfileUpdated);
  }, []);

  useEffect(() => {
    if (sessionLoading) {
      return;
    }

    void refreshProfile();
  }, [refreshProfile, profileRefreshToken, sessionLoading]);

  const value = useMemo<AuthContextValue>(
    () => ({
      supabase,
      session,
      user: session?.user ?? null,
      profile,
      loading: sessionLoading || authActionLoading || profileLoading,
      signInWithPassword,
      signUpWithPassword,
      sendPasswordReset,
      signOut,
      refreshProfile,
    }),
    [
      supabase,
      session,
      profile,
      sessionLoading,
      authActionLoading,
      profileLoading,
      signInWithPassword,
      signUpWithPassword,
      sendPasswordReset,
      signOut,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}
