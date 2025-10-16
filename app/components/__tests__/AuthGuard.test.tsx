import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import AuthGuard from "../AuthGuard";
import { useAuth } from "../AuthProvider";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

vi.mock("../AuthProvider", () => ({
  useAuth: vi.fn(),
}));

const replaceMock = vi.fn();
const mockUseRouter = vi.fn();
const mockUsePathname = vi.fn();
const mockUseSearchParams = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => mockUseRouter()),
  usePathname: vi.fn(() => mockUsePathname()),
  useSearchParams: vi.fn(() => mockUseSearchParams()),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseRouter = vi.mocked(useRouter);
const mockedUsePathname = vi.mocked(usePathname);
const mockedUseSearchParams = vi.mocked(useSearchParams);

describe("AuthGuard", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    mockedUseRouter.mockReturnValue({
      replace: replaceMock,
      refresh: vi.fn(),
      push: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as AppRouterInstance);
    mockedUsePathname.mockReturnValue("/projects");
    mockedUseSearchParams.mockReturnValue(new URLSearchParams() as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders loader while authentication is in progress", () => {
    mockedUseAuth.mockReturnValue({
      session: null,
      loading: true,
    } as any);

    render(
      <AuthGuard>
        <div>Child</div>
      </AuthGuard>
    );

    expect(screen.getByText("Checking authentication…")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to login when session is missing", async () => {
    mockedUseAuth.mockReturnValue({
      session: null,
      loading: false,
    } as any);
    mockedUsePathname.mockReturnValue("/projects");
    mockedUseSearchParams.mockReturnValue(new URLSearchParams("filter=active") as any);

    render(
      <AuthGuard>
        <div>Child</div>
      </AuthGuard>
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/login?redirect=%2Fprojects%3Ffilter%3Dactive"
      );
    });
  });

  it("renders children when authenticated", () => {
    mockedUseAuth.mockReturnValue({
      session: { user: { id: "user" } } as Session,
      loading: false,
    } as any);

    render(
      <AuthGuard>
        <div>Child content</div>
      </AuthGuard>
    );

    expect(screen.getByText("Child content")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
