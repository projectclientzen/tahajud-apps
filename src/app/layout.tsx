import type { Metadata, Viewport } from "next";
import { Amiri_Quran, Plus_Jakarta_Sans } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const amiriQuran = Amiri_Quran({
  subsets: ["arabic"],
  weight: "400",
  variable: "--font-amiri-quran",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Tahajud Tracker", template: "%s | Tahajud Tracker" },
  description: "Pendamping ibadah malam dari NgajiGaes.",
  applicationName: "Tahajud Tracker",
  appleWebApp: { capable: true, title: "Tahajud", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7ed" },
    { media: "(prefers-color-scheme: dark)", color: "#25372f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${jakarta.variable} ${amiriQuran.variable}`} suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint to avoid a bright flash at night. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
