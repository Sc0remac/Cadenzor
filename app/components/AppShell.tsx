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
  { href: "/timeline", label: "Timeline" },
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const navLinks = BASE_NAV_LINKS;

  const displayName =
    user?.user_metadata?.full_name?.trim() || user?.email || "Team member";

  const userInitials = useMemo(() => {
    const source =
      user?.user_metadata?.full_name?.trim() || user?.email || "Team member";

    const initials = source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");

    return initials || "U";
  }, [user?.email, user?.user_metadata?.full_name]);

  const handleProfileMenuBlur = (
    event: React.FocusEvent<HTMLDivElement>,
  ) => {
    const nextFocus = event.relatedTarget as Node | null;

    if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
      setProfileMenuOpen(false);
    }
  };

  const handleSignOut = async () => {
    setSignOutError(null);
    setSigningOut(true);
    setProfileMenuOpen(false);

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
            <span className="text-xl font-semibold text-gray-900">Kazador</span>
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
          <div
            className="relative"
            onMouseEnter={() => setProfileMenuOpen(true)}
            onMouseLeave={() => setProfileMenuOpen(false)}
            onFocusCapture={() => setProfileMenuOpen(true)}
            onBlurCapture={handleProfileMenuBlur}
          >
            <button
              type="button"
              onClick={() => setProfileMenuOpen((open) => !open)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900"
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
            >
              <span className="sr-only">Open profile menu</span>
              {userInitials}
            </button>
            <div
              className={`absolute right-0 mt-2 w-56 overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black/5 transition-all ${
                profileMenuOpen
                  ? "visible translate-y-0 opacity-100"
                  : "invisible -translate-y-1 opacity-0"
              }`}
            >
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-medium text-gray-900">{displayName}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
              <div className="py-1" role="menu" aria-label="Profile">
                <Link
                  href="/profile"
                  className="block px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
                  role="menuitem"
                >
                  Profile
                </Link>
                <Link
                  href="/settings/priorities"
                  className="block px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
                  role="menuitem"
                >
                  Priority settings
                </Link>
                {profile?.isAdmin ? (
                  <Link
                    href="/admin"
                    className="block px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
                    role="menuitem"
                  >
                    Admin
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                  role="menuitem"
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
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
