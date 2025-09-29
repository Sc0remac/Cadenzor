"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";

export default function LogoutPage() {
  const { signOut } = useAuth();
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const performSignOut = async () => {
      const error = await signOut();

      if (!isActive) {
        return;
      }

      if (error) {
        console.error("Failed to sign out", error);
        setErrorMessage(error.message ?? "We couldn’t complete the sign out");
        return;
      }

      router.replace("/login");
      router.refresh();
    };

    performSignOut();

    return () => {
      isActive = false;
    };
  }, [router, signOut]);

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        {errorMessage ? (
          <>
            <p className="text-sm font-medium text-red-600">{errorMessage}</p>
            <p className="mt-2 text-sm text-gray-600">
              Please try again or refresh the page.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-600">Signing you out…</p>
        )}
      </div>
    </div>
  );
}
