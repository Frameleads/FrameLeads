import type { Metadata } from "next";
import { Oxanium, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const oxanium = Oxanium({ subsets: ['latin'], variable: '--font-oxanium' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  title: "FrameLeads — Governed Decisions After the Reply",
  description:
    "FrameLeads uses reply intent, prospect context, and sales rules to guide what happens after a prospect replies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${oxanium.variable} ${jetbrainsMono.variable} min-h-screen bg-background font-sans antialiased w-full max-w-[100vw] overflow-x-hidden`}
        suppressHydrationWarning
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
