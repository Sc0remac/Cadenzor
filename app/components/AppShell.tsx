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
<<<<<<< ours
    <div className="relative min-h-screen overflow-hidden">
<<<<<<< ours
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
=======
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,201,245,0.15),transparent_60%),radial-gradient(circle_at_80%_0%,rgba(122,90,255,0.18),transparent_55%),radial-gradient(circle_at_20%_100%,rgba(217,70,239,0.14),transparent_65%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(59,201,245,0.25),transparent_70%)] blur-3xl opacity-70" />
      <div className="pointer-events-none absolute inset-x-16 bottom-0 h-80 bg-[radial-gradient(circle_at_center,rgba(7,11,28,0.7),transparent_70%)]" />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[rgba(6,10,22,0.78)]/80 backdrop-blur-2xl shadow-[0_1px_0_rgba(255,255,255,0.06),0_30px_80px_-45px_rgba(3,6,18,0.9)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <div className="flex flex-1 items-center gap-8">
            <Link href="/" className="group relative flex items-center gap-3">
              <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_30%_30%,rgba(59,201,245,0.65),rgba(31,122,224,0.55))] text-primary shadow-glow">
                <span className="absolute inset-0 rounded-3xl border border-white/20" />
                <span className="relative font-display text-lg tracking-[0.16em]">CZ</span>
              </span>
              <div className="flex flex-col">
                <span className="font-display text-[1.35rem] font-semibold tracking-[0.26em] text-primary">
                  Cadenzor
                </span>
                <span className="text-xs font-medium uppercase tracking-[0.3em] text-tertiary">
                  Orchestration command
                </span>
              </div>
            </Link>
            <nav className="hidden flex-1 items-center justify-end gap-2 rounded-full border border-white/10 bg-[rgba(16,22,40,0.65)] px-3 py-1 text-sm shadow-glow md:flex">
>>>>>>> theirs
=======
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-8">
            <span className="text-xl font-semibold text-gray-900">Cadenzor</span>
            <nav className="flex items-center gap-4">
>>>>>>> theirs
              {navLinks.map((link) => {
                const active = isActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active
<<<<<<< ours
<<<<<<< ours
                        ? "bg-white/80 text-slate-900 shadow-glow"
                        : "text-slate-200 hover:bg-white/10 hover:text-white"
=======
                        ? "bg-[rgba(59,201,245,0.18)] text-primary shadow-[0_18px_38px_-18px_rgba(59,201,245,0.6)]"
                        : "text-secondary hover:bg-white/5 hover:text-primary"
>>>>>>> theirs
                    }`}
                  >
                    <span className="relative z-10">{link.label}</span>
                    {active ? (
<<<<<<< ours
                      <span className="absolute inset-0 -z-10 rounded-full bg-gradient-to-r from-brand-400/90 via-brand-300/90 to-aurora/80" />
=======
                      <span className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.65),rgba(31,122,224,0.4))]" />
>>>>>>> theirs
                    ) : null}
=======
                        ? "bg-gray-900 text-white"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    {link.label}
>>>>>>> theirs
                  </Link>
                );
              })}
              {PLACEHOLDER_BUTTONS.map((label) => (
                <button
                  key={label}
<<<<<<< ours
<<<<<<< ours
                  className="inline-flex cursor-not-allowed items-center rounded-full px-4 py-2 font-medium text-slate-400/60"
=======
                  className="inline-flex cursor-not-allowed items-center rounded-full px-4 py-2 font-medium text-tertiary/80"
>>>>>>> theirs
=======
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-md px-3 py-2 text-sm font-medium text-gray-400"
>>>>>>> theirs
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
<<<<<<< ours
          <div className="flex shrink-0 items-center gap-4">
            <div className="hidden text-right md:block">
<<<<<<< ours
              <p className="text-sm font-semibold text-white/90">{userDisplay}</p>
              {userEmail ? <p className="text-xs text-slate-300/80">{userEmail}</p> : null}
=======
              <p className="text-sm font-semibold text-primary tracking-[0.08em]">{userDisplay}</p>
              {userEmail ? <p className="text-xs text-tertiary">{userEmail}</p> : null}
>>>>>>> theirs
=======
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">
                {user?.user_metadata?.full_name || user?.email || "Team member"}
              </p>
              <p className="text-xs text-gray-500">{user?.email}</p>
>>>>>>> theirs
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
<<<<<<< ours
<<<<<<< ours
              className="group relative inline-flex items-center overflow-hidden rounded-full border border-white/10 bg-white/10 px-5 py-2 text-sm font-semibold text-white shadow-glow transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:shadow-elevation focus:outline-none focus:ring-2 focus:ring-brand-400/70 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-brand-500 via-rose-500 to-sky-500 opacity-90 transition duration-300 ease-gentle-spring" />
              <span className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.55)_40%,rgba(255,255,255,0)_70%)] bg-[length:200%_100%] opacity-0 transition duration-500 ease-linear group-hover:opacity-100" />
              <span className="relative">
=======
              className="group relative inline-flex items-center overflow-hidden rounded-full border border-white/10 bg-[rgba(217,70,239,0.12)] px-5 py-2 text-sm font-semibold text-primary shadow-[0_24px_60px_-30px_rgba(217,70,239,0.65)] transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:shadow-[0_32px_70px_-28px_rgba(217,70,239,0.8)] focus:outline-none focus:ring-2 focus:ring-[rgba(217,70,239,0.5)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="absolute inset-0 bg-[linear-gradient(140deg,rgba(217,70,239,0.8),rgba(148,63,255,0.65))] opacity-80 transition duration-300 ease-gentle-spring group-hover:opacity-100" />
              <span className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.4)_45%,rgba(255,255,255,0)_75%)] bg-[length:220%_100%] opacity-0 transition duration-500 ease-linear group-hover:opacity-100" />
              <span className="relative tracking-[0.18em] uppercase">
>>>>>>> theirs
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
<<<<<<< ours
                    ? "bg-white/80 text-slate-900 shadow-glow"
                    : "bg-white/10 text-slate-200 hover:bg-white/15 hover:text-white"
=======
                    ? "bg-[rgba(59,201,245,0.2)] text-primary shadow-[0_18px_38px_-18px_rgba(59,201,245,0.6)]"
                    : "bg-[rgba(26,32,52,0.7)] text-secondary hover:text-primary"
>>>>>>> theirs
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {signOutError ? (
          <div className="mx-auto max-w-7xl px-6 pb-4">
<<<<<<< ours
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 shadow-glow">
=======
            <div className="rounded-xl border border-[rgba(217,70,239,0.45)] bg-[rgba(217,70,239,0.12)] px-4 py-2 text-sm text-primary opacity-90 shadow-[0_28px_60px_-40px_rgba(217,70,239,0.7)]">
>>>>>>> theirs
              {signOutError}
            </div>
          </div>
        ) : null}
      </header>

<<<<<<< ours
      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 lg:px-8">
        <div className="space-y-10">
=======
      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-20 pt-12 sm:px-6 lg:px-8">
        <div className="space-y-12">
>>>>>>> theirs
          {children}
        </div>
      </main>
=======
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
>>>>>>> theirs
    </div>
  );
}
