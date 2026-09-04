import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geist = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Declaration — A card table for six friends",
    template: "%s · Declaration",
  },
  description: "A mobile-first social card game with six private hands, one shared game, and the call your group already uses.",
  applicationName: "Declaration",
  keywords: ["multiplayer card game", "remote game night", "social game", "mobile game", "Declaration"],
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Declaration",
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: "Declaration — A card table for six friends",
    description: "Six private hands. Two teams. One shared game, wherever life takes you.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Declaration — A card table for six friends",
    description: "Six private hands. Two teams. One shared game, wherever life takes you.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f0e7",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={`${geist.variable} ${geistMono.variable}`} lang="en">
      <body>{children}</body>
    </html>
  );
}
