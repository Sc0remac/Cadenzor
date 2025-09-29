import type { ReactNode } from "react";
import { Suspense } from "react";
import AuthGuard from "../../components/AuthGuard";
import AppShell from "../../components/AppShell";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">
            Loading your workspace…
          </div>
        }
      >
        <AppShell>{children}</AppShell>
      </Suspense>
    </AuthGuard>
  );
}
