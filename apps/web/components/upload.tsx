// apps/web/components/upload.tsx
"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";
import { Notice } from "@/components/ui/kit";

export function Upload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ document_id?: string; doc_type?: string; status?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(filesInput: FileList | File[]) {
    const files = Array.from(filesInput);
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let lastResult: { document_id?: string; doc_type?: string; status?: string } | null = null;
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch(`${API.intelligence}/v1/documents`, { method: "POST", body: fd });
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail ?? "failed");
        lastResult = j;
      }
      setResult(lastResult);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy && e.dataTransfer.files?.length) {
            send(e.dataTransfer.files);
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-7 text-center transition-colors duration-150 ease-out-quart focus-within:border-neutral-950 focus-within:ring-2 focus-within:ring-neutral-950/20 ${
          dragging
            ? "border-neutral-950 bg-neutral-100/70"
            : "border-neutral-300 bg-neutral-50/50 hover:border-neutral-400 hover:bg-neutral-50"
        } ${busy ? "cursor-wait opacity-75" : ""}`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700">
          {busy ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
        </div>
        <span className="text-sm font-medium text-neutral-900">
          {busy ? "Processing document..." : "Choose CAD, PDF, DOCX, image or text files"}
        </span>
        <span className="text-xs text-neutral-600">
          Click to browse or drop files here for automated extraction and validation
        </span>
        <input
          type="file"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              send(e.target.files);
            }
          }}
        />
      </label>

      {error && <Notice tone="bad">{error}</Notice>}

      {result && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
          <span>
            <strong className="font-semibold">{result.doc_type ?? "document"}</strong>: {result.status}
          </span>
          {result.document_id && (
            <Link
              className="rounded font-semibold text-emerald-950 underline underline-offset-2 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              href={`/documents/${result.document_id}`}
            >
              Open Document
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
