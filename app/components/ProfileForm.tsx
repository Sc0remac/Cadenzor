"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";

interface ProfileFormState {
  email: string;
  fullName: string;
  role: string;
  company: string;
  phone: string;
  location: string;
  bio: string;
}

const EMPTY_STATE: ProfileFormState = {
  email: "",
  fullName: "",
  role: "",
  company: "",
  phone: "",
  location: "",
  bio: "",
};

export default function ProfileForm() {
  const { supabase, user } = useAuth();
  const [formState, setFormState] = useState<ProfileFormState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      return;
    }

    let isMounted = true;
    setLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);

    supabase
      .from("profiles")
      .select(
        "email, full_name, role, company, phone, location, bio"
      )
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) {
          return;
        }

        if (error) {
          console.error("Failed to load profile", error);
          setErrorMessage(error.message ?? "Unable to load profile");
          setLoading(false);
          return;
        }

        if (data) {
          setFormState({
            email: data.email ?? user?.email ?? "",
            fullName: data.full_name ?? "",
            role: data.role ?? "",
            company: data.company ?? "",
            phone: data.phone ?? "",
            location: data.location ?? "",
            bio: data.bio ?? "",
          });
        } else {
          setFormState({
            ...EMPTY_STATE,
            email: user?.email ?? "",
          });
        }

        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [supabase, userId, user?.email]);

  const isDisabled = useMemo(() => saving || loading || !userId, [saving, loading, userId]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    if (!userId) {
      setErrorMessage("You must be signed in to update your profile.");
      return;
    }

    setSaving(true);

    const payload = {
      id: userId,
      email: user?.email ?? formState.email.trim(),
      full_name: formState.fullName.trim(),
      role: formState.role.trim(),
      company: formState.company.trim(),
      phone: formState.phone.trim(),
      location: formState.location.trim(),
      bio: formState.bio.trim(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.error("Failed to update profile", error);
      setErrorMessage(error.message ?? "Unable to save profile details");
    } else {
      const nextState: ProfileFormState = {
        email: payload.email,
        fullName: payload.full_name,
        role: payload.role,
        company: payload.company,
        phone: payload.phone,
        location: payload.location,
        bio: payload.bio,
      };

      setFormState(nextState);
      setStatusMessage("Profile updated successfully");

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("profile:updated", { detail: nextState })
        );
      }
    }

    setSaving(false);
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">Loading profile…</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <fieldset className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email (sign-in)
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={formState.email || user?.email || ''}
            readOnly
            disabled
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm bg-gray-100 text-gray-600"
          />
        </div>

        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            value={formState.fullName}
            onChange={handleChange}
            disabled={isDisabled}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            placeholder="Oran Example"
          />
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700">
            Role or title
          </label>
          <input
            id="role"
            name="role"
            type="text"
            value={formState.role}
            onChange={handleChange}
            disabled={isDisabled}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            placeholder="Artist Manager"
          />
        </div>

        <div>
          <label htmlFor="company" className="block text-sm font-medium text-gray-700">
            Company
          </label>
          <input
            id="company"
            name="company"
            type="text"
            value={formState.company}
            onChange={handleChange}
            disabled={isDisabled}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            placeholder="Kazador"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
            Phone number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            value={formState.phone}
            onChange={handleChange}
            disabled={isDisabled}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            placeholder="+44 1234 567890"
          />
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-gray-700">
            Location
          </label>
          <input
            id="location"
            name="location"
            type="text"
            value={formState.location}
            onChange={handleChange}
            disabled={isDisabled}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            placeholder="London, UK"
          />
        </div>

        <div className="md:col-span-2">
          <label htmlFor="bio" className="block text-sm font-medium text-gray-700">
            Bio
          </label>
          <textarea
            id="bio"
            name="bio"
            value={formState.bio}
            onChange={handleChange}
            disabled={isDisabled}
            rows={4}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            placeholder="Tell the team a little about yourself"
          />
        </div>
      </fieldset>

      {errorMessage ? (
        <div className="rounded-md bg-red-100 px-4 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {statusMessage ? (
        <div className="rounded-md bg-green-100 px-4 py-2 text-sm text-green-700">
          {statusMessage}
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={isDisabled}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
