import "./globals.css";
import { ReactNode } from "react";
import { AuthProvider } from "../components/AuthProvider";

export const metadata = {
  title: "Kazador",
  description: "Email triage dashboard for artist management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
