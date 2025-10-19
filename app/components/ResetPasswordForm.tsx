"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./AuthProvider";

export default function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { supabase, session } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRecoveryFlow = searchParams?.get("type") === "recovery";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!password || !confirmPassword) {
      setFormError("Please enter and confirm your new password.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters long.");
      return;
    }

    if (!session) {
      setFormError("Your reset link has expired. Request a new one from the sign in page.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setFormError(error.message || "Unable to update password. Please try again.");
      return;
    }

    setSuccessMessage("Password updated. You can safely sign in with your new password.");
    setPassword("");
    setConfirmPassword("");

    setTimeout(() => {
      router.replace("/login");
    }, 1500);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow"
    >
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Reset your password</h1>
        <p className="mt-1 text-sm text-gray-600">
          {isRecoveryFlow
            ? "Choose a new password to finish resetting your account."
            : "If you arrived here by mistake, head back to the sign in page."}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            New password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            placeholder="Enter a new password"
            required
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-gray-700"
          >
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            placeholder="Re-enter your new password"
            required
          />
        </div>
      </div>

      {formError ? (
        <div className="rounded-md bg-red-100 px-4 py-2 text-sm text-red-700">
          {formError}
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-md bg-emerald-100 px-4 py-2 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {submitting ? "Updating…" : "Update password"}
      </button>

      <button
        type="button"
        onClick={() => router.push("/login")}
        className="w-full text-center text-sm font-medium text-gray-900 hover:underline"
      >
        Back to sign in
      </button>
    </form>
  );
}
