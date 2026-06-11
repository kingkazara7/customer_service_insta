import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PartSelect Parts Assistant | Refrigerator & Dishwasher Parts",
  description:
    "PartSelect smart assistant: diagnose refrigerator and dishwasher problems, find parts, check compatibility, get installation guidance, and order — all in chat.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
