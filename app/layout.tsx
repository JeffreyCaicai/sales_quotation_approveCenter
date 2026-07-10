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

const SITE_TITLE = "报价审批中心";
const SITE_DESCRIPTION = "面向销售、销售主管与 CEO 的楼宇报价与折扣审批协作工作台。";
const SOCIAL_IMAGE_PATH = "/og.png";
const FALLBACK_ORIGIN = "http://localhost";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = requestOrigin(requestHeaders);
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
      locale: "zh_CN",
      url: origin,
      siteName: SITE_TITLE,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [{
        url: socialImageUrl,
        width: 1672,
        height: 941,
        alt: "报价审批中心楼宇报价与折扣审批工作台预览",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [{
        url: socialImageUrl,
        alt: "报价审批中心楼宇报价与折扣审批工作台预览",
      }],
    },
  };
}

function requestOrigin(requestHeaders: Headers): URL {
  const host = validHost(requestHeaders.get("host"));
  if (!host) {
    return new URL(FALLBACK_ORIGIN);
  }

  const forwardedHost = validHost(firstForwardedValue(requestHeaders.get("x-forwarded-host")) ?? null);
  const forwardingIsConsistent = !requestHeaders.has("x-forwarded-host")
    || forwardedHost?.toLowerCase() === host.toLowerCase();
  const forwardedProtocol = forwardingIsConsistent
    ? firstForwardedValue(requestHeaders.get("x-forwarded-proto"))
    : undefined;
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : isLocalHost(host) ? "http" : "https";

  return new URL(`${protocol}://${host}`);
}

function validHost(value: string | null): string | undefined {
  const host = value?.trim();
  if (!host || host.length > 255 || /[\s,/\\@?#]/.test(host)) {
    return undefined;
  }

  try {
    const parsed = new URL(`http://${host}`);
    return parsed.hostname ? host : undefined;
  } catch {
    return undefined;
  }
}

function firstForwardedValue(value: string | null): string | undefined {
  const first = value?.split(",", 1)[0].trim();
  return first || undefined;
}

function isLocalHost(host: string) {
  const hostname = new URL(`http://${host}`).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
