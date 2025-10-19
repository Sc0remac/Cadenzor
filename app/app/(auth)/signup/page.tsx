import type { Metadata } from "next";
import SignupForm from "../../../components/SignupForm";

export const metadata: Metadata = {
  title: "Kazador | Sign up",
};

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-100 via-white to-gray-100 px-4">
      <SignupForm />
    </div>
  );
}
