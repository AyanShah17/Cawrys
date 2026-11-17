// apps/web/app/layout.tsx
import "./globals.css";
import React from "react";
import type { Metadata } from "next";
import { LayoutWrapper } from "@/components/layout-wrapper";
import { getBrand } from "@/lib/brand";
import { getMe } from "@/lib/server";
import { ModeProvider } from "@/lib/mode-context";

export async function generateMetadata(): Promise<Metadata> {
  const b = getBrand();
  return {
    title: { default: b.name, template: `%s · ${b.name}` },
    description: b.tagline,
    icons: { icon: "/icon.svg" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = getBrand();
  const me = await getMe();
  return (
    <html lang="en">
      <head>
        {/* brand colour is validated to digits in lib/brand.ts, so this cannot carry markup */}
        <style dangerouslySetInnerHTML={{ __html: `:root{--brand:${brand.rgb}}` }} />
      </head>
      <body className="min-h-screen antialiased bg-[#f4f5f8] text-neutral-900">
        <ModeProvider>
          {me ? (
            <LayoutWrapper brand={brand} email={me.email} role={me.role}>
              {children}
            </LayoutWrapper>
          ) : (
            children
          )}
        </ModeProvider>
      </body>
    </html>
  );
}
