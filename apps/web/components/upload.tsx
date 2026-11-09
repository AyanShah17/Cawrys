"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";

export function Upload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File) {
    setBusy(true); setError(null); setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`${API.intelligence}/v1/documents`, { method: "POST", body: fd });
      if (r.status === 401) { window.location.href = "/login"; return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? "failed");
      setResult(j);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/20 p-6 text-center text-sm text-neutral-300 hover:border-white/40">
        {busy ? "Processing…" : "Choose a PDF, DOCX, image or text file"}
        <input type="file" className="hidden" disabled={busy}
          onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      </label>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {result && (
        <p className="mt-3 text-xs text-neutral-300">
          {result.doc_type ?? "document"}: {result.status}.{" "}
          <Link className="underline" href={`/documents/${result.document_id}`}>Open</Link>
        </p>
      )}
    </div>
  );
}
