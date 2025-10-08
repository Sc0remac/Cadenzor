"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";

const BASE_NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/inbox", label: "Inbox" },
  { href: "/today", label: "Today" },
  { href: "/projects", label: "Projects" },
  { href: "/profile", label: "Profile" },
];

const PLACEHOLDER_BUTTONS = ["Clients", "Reports"];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const navLinks = useMemo(() => {
    const links = [...BASE_NAV_LINKS];

    if (profile?.isAdmin) {
      const profileIndex = links.findIndex((link) => link.href === "/profile");
      const adminLink = { href: "/admin", label: "Admin" };

      if (profileIndex >= 0) {
        links.splice(profileIndex, 0, adminLink);
      } else {
        links.push(adminLink);
      }
    }

    return links;
  }, [profile?.isAdmin]);

  const handleSignOut = async () => {
    setSignOutError(null);
    setSigningOut(true);

    const error = await signOut();

    if (error) {
      setSignOutError(error.message ?? "Failed to sign out");
      setSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
    setSigningOut(false);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-8">
            <span className="text-xl font-semibold text-gray-900">Cadenzor</span>
            <nav className="flex items-center gap-4">
              {navLinks.map((link) => {
                const active = isActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-gray-900 text-white"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
              {PLACEHOLDER_BUTTONS.map((label) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-md px-3 py-2 text-sm font-medium text-gray-400"
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">
                {user?.user_metadata?.full_name || user?.email || "Team member"}
              </p>
              <p className="text-xs text-gray-500">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
        {signOutError ? (
          <div className="bg-red-100 px-6 py-2 text-sm text-red-700">
            {signOutError}
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
