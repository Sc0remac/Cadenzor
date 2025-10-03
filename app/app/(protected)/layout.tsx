import type { ReactNode } from "react";
import { Suspense } from "react";
import AuthGuard from "../../components/AuthGuard";
import AppShell from "../../components/AppShell";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">
          Loading your workspace…
        </div>
      }
    >
      <AuthGuard>
        <AppShell>{children}</AppShell>
      </AuthGuard>
    </Suspense>
  );
}
