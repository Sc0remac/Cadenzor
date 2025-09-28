import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Cadenzor",
  description: "Email triage dashboard for artist management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 font-sans">
        {children}
      </body>
    </html>
  );
}