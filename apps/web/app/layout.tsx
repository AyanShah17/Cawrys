import "./globals.css";
import Link from "next/link";
import { UserMenu } from "@/components/user-menu";
import { getMe } from "@/lib/server";

export const metadata = { title: "Cawrys", description: "Customer-owned AI operations platform" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {me && (
          <nav className="flex items-center gap-6 border-b border-white/10 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold tracking-tight">Cawrys</Link>
            <Link href="/" className="text-neutral-400 hover:text-white">Intelligence</Link>
            <Link href="/playbooks" className="text-neutral-400 hover:text-white">Execution</Link>
            <Link href="/approvals" className="text-neutral-400 hover:text-white">Approvals</Link>
            <Link href="/audit" className="text-neutral-400 hover:text-white">Audit</Link>
            <UserMenu email={me.email} role={me.role} />
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
