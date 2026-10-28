import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import localFont from "next/font/local";
import { UIMotionProvider } from "@/components/ui/titanium/UIMotionProvider";
import "./globals.css";
import "@/styles/titanium.css";

const heebo = localFont({
  src: [
    { path: "./fonts/Heebo-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Heebo-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Heebo-SemiBold.ttf", weight: "600", style: "normal" },
  ],
  variable: "--font-ui",
  display: "swap",
});

// Existing printed paper keeps its accepted Rubik typeface.
const printFont = Rubik({
  variable: "--font-print",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "CONTRACTORSYSTEM",
  description: "מערכת ניהול תקציבים לקבלנים",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className="dark">
      <body
        className={`${heebo.variable} ${printFont.variable} font-sans antialiased bg-background text-foreground min-h-screen`}
      >
        <UIMotionProvider>{children}</UIMotionProvider>
      </body>
    </html>
  );
}
