// apps/web/app/layout.tsx
import "./globals.css";
import React from "react";
import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
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
      <body className="min-h-screen antialiased bg-[#07080d] text-neutral-100">
        <ModeProvider>
          {me ? (
            <div className="flex min-h-screen">
              <Sidebar brand={brand} email={me.email} role={me.role} />
              <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
                <div className="mx-auto max-w-6xl">{children}</div>
              </main>
            </div>
          ) : (
            children
          )}
        </ModeProvider>
      </body>
    </html>
  );
}
