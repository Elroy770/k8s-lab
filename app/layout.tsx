import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kubernetes Story Lab",
  description:
    "Learn Kubernetes core concepts by running kubectl against a simulated cluster.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
