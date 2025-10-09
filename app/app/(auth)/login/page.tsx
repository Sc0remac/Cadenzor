import type { Metadata } from "next";
import LoginForm from "../../../components/LoginForm";

export const metadata: Metadata = {
  title: "Kazador | Sign in",
};

interface Props {
  searchParams?: { redirect?: string };
}

export default function LoginPage({ searchParams }: Props) {
  const rawRedirect =
    typeof searchParams?.redirect === "string" && searchParams.redirect.length > 0
      ? searchParams.redirect
      : undefined;
  const redirectParam =
    rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-100 via-white to-gray-100 px-4">
      <LoginForm redirectTo={redirectParam} />
    </div>
  );
}
