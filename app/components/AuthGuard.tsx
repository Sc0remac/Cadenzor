"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./AuthProvider";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!session) {
      const query = searchParams?.toString();
      const redirectPath = query ? `${pathname}?${query}` : pathname;
      const redirectParam = redirectPath && redirectPath !== "/"
        ? `?redirect=${encodeURIComponent(redirectPath)}`
        : "";

      router.replace(`/login${redirectParam}`);
    }
  }, [loading, session, router, pathname, searchParams]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-600">
        Checking authentication…
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return <>{children}</>;
}
