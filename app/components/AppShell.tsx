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

  const userDisplay = user?.user_metadata?.full_name || user?.email || "Team member";
  const userEmail = user?.email || "";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid-light bg-[length:24px_24px] opacity-30" />
      <div className="pointer-events-none absolute -top-32 right-0 h-72 w-72 rounded-full bg-hero-gradient blur-3xl opacity-50" />
      <div className="pointer-events-none absolute bottom-0 left-12 h-72 w-72 rounded-full bg-aurora/40 blur-3xl" />

      <header className="sticky top-0 z-20 border-b border-white/10 bg-midnight/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-5">
          <div className="flex flex-1 items-center gap-8">
            <Link href="/" className="group relative flex items-center gap-3">
              <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-hero-gradient text-white shadow-glow">
                <span className="absolute inset-0 animate-pulseGlow rounded-2xl" />
                <span className="relative text-lg font-semibold">Cz</span>
              </span>
              <div className="flex flex-col">
                <span className="bg-gradient-to-r from-brand-300 via-white to-aurora bg-clip-text text-xl font-semibold text-transparent">
                  Cadenzor
                </span>
                <span className="text-xs font-medium text-slate-300/80">
                  Your orchestration command center
                </span>
              </div>
            </Link>
            <nav className="hidden flex-1 items-center justify-end gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-sm shadow-glow md:flex">
              {navLinks.map((link) => {
                const active = isActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`group relative inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium transition duration-300 ease-gentle-spring ${
                      active
                        ? "bg-white/80 text-slate-900 shadow-glow"
                        : "text-slate-200 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className="relative z-10">{link.label}</span>
                    {active ? (
                      <span className="absolute inset-0 -z-10 rounded-full bg-gradient-to-r from-brand-400/90 via-brand-300/90 to-aurora/80" />
                    ) : null}
                  </Link>
                );
              })}
              {PLACEHOLDER_BUTTONS.map((label) => (
                <span
                  key={label}
                  className="inline-flex cursor-not-allowed items-center rounded-full px-4 py-2 font-medium text-slate-400/60"
                >
                  {label}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold text-white/90">{userDisplay}</p>
              {userEmail ? <p className="text-xs text-slate-300/80">{userEmail}</p> : null}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="group relative inline-flex items-center overflow-hidden rounded-full border border-white/10 bg-white/10 px-5 py-2 text-sm font-semibold text-white shadow-glow transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:shadow-elevation focus:outline-none focus:ring-2 focus:ring-brand-400/70 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-brand-500 via-rose-500 to-sky-500 opacity-90 transition duration-300 ease-gentle-spring" />
              <span className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.55)_40%,rgba(255,255,255,0)_70%)] bg-[length:200%_100%] opacity-0 transition duration-500 ease-linear group-hover:opacity-100" />
              <span className="relative">
                {signingOut ? "Signing out…" : "Sign out"}
              </span>
            </button>
          </div>
        </div>
        <nav className="mx-auto mt-3 flex w-full max-w-7xl gap-2 overflow-x-auto px-6 pb-4 text-sm md:hidden">
          {navLinks.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative inline-flex items-center rounded-full px-4 py-2 font-medium transition duration-300 ease-gentle-spring ${
                  active
                    ? "bg-white/80 text-slate-900 shadow-glow"
                    : "bg-white/10 text-slate-200 hover:bg-white/15 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {signOutError ? (
          <div className="mx-auto max-w-7xl px-6 pb-4">
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 shadow-glow">
              {signOutError}
            </div>
          </div>
        ) : null}
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 lg:px-8">
        <div className="space-y-10">
          {children}
        </div>
      </main>
    </div>
  );
}
