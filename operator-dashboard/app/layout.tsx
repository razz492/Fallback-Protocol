import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// 1. Import your new WalletContextProvider
import { WalletContextProvider } from "../components/WalletContextProvider"; 
// (Note: If your components folder is inside src, change this to "@/components/WalletContextProvider")

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fallback Protocol — Operator Dashboard",
  description: "Teleoperation command center for the Fallback Protocol Solana program. Monitor robots, accept tasks, and resolve incidents.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-white">
        {/* 2. Wrap the children inside the WalletContextProvider */}
        <WalletContextProvider>
            {children}
        </WalletContextProvider>
      </body>
    </html>
  );
}