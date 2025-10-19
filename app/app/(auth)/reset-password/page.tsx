import type { Metadata } from "next";
import ResetPasswordForm from "../../../components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Kazador | Reset password",
};

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-100 via-white to-gray-100 px-4">
      <ResetPasswordForm />
    </div>
  );
}
