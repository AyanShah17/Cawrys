import { Spotlight } from "@/components/ui/spotlight";
import { BentoGrid, BentoItem } from "@/components/ui/bento-grid";
import Link from "next/link";
import { type DocRow } from "@/lib/api";
import { getMe, serverGet } from "@/lib/server";
import { Upload } from "@/components/upload";

export const dynamic = "force-dynamic";

export default async function Home() {
  let docs: DocRow[] = [];
  let err: string | null = null;
  const me = await getMe();
  const canUpload = me?.role === "admin" || me?.role === "engineer";
  try { docs = await serverGet<DocRow[]>("intelligence", "/v1/documents"); } catch (e: any) { err = e.message; }

  return (
    <main>
      <section className="relative overflow-hidden px-6 pb-16 pt-24 text-center">
        <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" />
        <h1 className="relative z-10 bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-5xl font-bold text-transparent md:text-7xl">
          Cawrys
        </h1>
        <p className="relative z-10 mx-auto mt-4 max-w-xl text-neutral-400">
          Understand, decide, process, execute, learn. Your software, infrastructure, AI keys and data.
        </p>
      </section>

      <BentoGrid className="px-6 pb-16">
        <BentoItem title="Upload a document" description="Extraction, validation and reasoning run in your environment." className="md:col-span-1">
          {canUpload ? <Upload /> : <p className="text-xs text-neutral-500">Your role can view results but not upload.</p>}
        </BentoItem>
        <BentoItem title="Recent documents" className="md:col-span-2">
          {err && <p className="text-xs text-red-400">Intelligence service unreachable: {err}</p>}
          <table className="w-full text-left text-xs">
            <thead className="text-neutral-500"><tr><th className="py-1">File</th><th>Type</th><th>Status</th><th>Confidence</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-white/5">
                  <td className="py-1.5"><Link className="underline" href={`/documents/${d.id}`}>{d.filename}</Link></td>
                  <td>{d.doc_type ?? "-"}</td>
                  <td>{d.status}</td>
                  <td>{d.confidence ?? "-"}</td>
                </tr>
              ))}
              {!docs.length && !err && <tr><td colSpan={4} className="py-3 text-neutral-500">Nothing processed yet.</td></tr>}
            </tbody>
          </table>
        </BentoItem>
      </BentoGrid>
    </main>
  );
}
