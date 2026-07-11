import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_TITLE = "Quotation Approval Center";
const SITE_DESCRIPTION = "Quotation and discount approval workspace for Sales, Sales Managers, and the CEO.";
const SOCIAL_IMAGE_PATH = "/og.png";
const FALLBACK_ORIGIN = "http://localhost";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = metadataOrigin(requestHeaders);
  const socialImageUrl = new URL(SOCIAL_IMAGE_PATH, origin).toString();

  return {
    metadataBase: origin,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: origin,
      siteName: SITE_TITLE,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [{
        url: socialImageUrl,
        width: 1672,
        height: 941,
        alt: "Quotation Approval Center workspace preview",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [{
        url: socialImageUrl,
        alt: "Quotation Approval Center workspace preview",
      }],
    },
  };
}

function metadataOrigin(requestHeaders: Headers): URL {
  return configuredSiteOrigin(process.env.SITE_ORIGIN)
    ?? localRequestOrigin(requestHeaders.get("host"))
    ?? new URL(FALLBACK_ORIGIN);
}

function configuredSiteOrigin(value: string | undefined): URL | undefined {
  const candidate = value?.trim();
  if (
    !candidate
    || /[\u0000-\u0020\u007f]/.test(candidate)
    || !/^https?:\/\/[^/?#\\]+\/?$/i.test(candidate)
  ) {
    return undefined;
  }

  try {
    const origin = new URL(candidate);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:")
      || origin.username
      || origin.password
      || origin.pathname !== "/"
      || origin.search
      || origin.hash
    ) {
      return undefined;
    }

    return new URL(origin.origin);
  } catch {
    return undefined;
  }
}

function localRequestOrigin(value: string | null): URL | undefined {
  const host = value?.trim();
  if (
    !host
    || host.length > 255
    || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)
  ) {
    return undefined;
  }

  try {
    const origin = new URL(`http://${host}`);
    return new URL(origin.origin);
  } catch {
    return undefined;
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
