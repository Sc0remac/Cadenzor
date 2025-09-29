"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";

interface ProfileSnapshotState {
  fullName: string;
  role: string;
  company: string;
}

const EMPTY_STATE: ProfileSnapshotState = {
  fullName: "",
  role: "",
  company: "",
};

export default function ProfileSnapshot() {
  const { supabase, user } = useAuth();
  const [profile, setProfile] = useState<ProfileSnapshotState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const handleProfileUpdated = () => {
      setRefreshToken((token) => token + 1);
    };

    window.addEventListener("profile:updated", handleProfileUpdated);
    return () => window.removeEventListener("profile:updated", handleProfileUpdated);
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (!user?.id) {
      setLoading(false);
      setProfile(EMPTY_STATE);
      return () => {
        isMounted = false;
      };
    }

    setLoading(true);

    supabase
      .from("profiles")
      .select("full_name, role, company")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) {
          return;
        }

        if (error) {
          console.error("Failed to load profile snapshot", error);
          setProfile(EMPTY_STATE);
        } else if (data) {
          setProfile({
            fullName: data.full_name ?? "",
            role: data.role ?? "",
            company: data.company ?? "",
          });
        } else {
          setProfile(EMPTY_STATE);
        }

        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [supabase, user?.id, refreshToken]);

  const displayName = useMemo(() => {
    if (profile.fullName.trim()) {
      return profile.fullName;
    }
    return user?.user_metadata?.full_name || user?.email || "Your profile";
  }, [profile.fullName, user]);

  const email = user?.email ?? "No email on file";
  const role = profile.role || (user?.user_metadata?.role as string | undefined);
  const company =
    profile.company || (user?.user_metadata?.company as string | undefined);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part: string) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <section className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gray-900 text-lg font-semibold text-white">
        {initials || "?"}
      </div>
      <div className="space-y-1 text-sm">
        <p className="text-base font-semibold text-gray-900">
          {loading ? "Loading profile…" : displayName}
        </p>
        <p className="text-gray-600">{email}</p>
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="rounded-full bg-gray-100 px-3 py-1">
            {role || (loading ? "Loading…" : "Role not set")}
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1">
            {company || (loading ? "Loading…" : "Company not set")}
          </span>
        </div>
      </div>
    </section>
  );
}
