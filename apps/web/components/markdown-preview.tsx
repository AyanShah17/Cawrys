// apps/web/components/markdown-preview.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { IconCheck } from "@/components/ui/icons";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

type InlineTokenType =
  | "code"
  | "link"
  | "autolink"
  | "strike"
  | "bolditalic"
  | "bold"
  | "italic";

interface InlineMatch {
  type: InlineTokenType;
  index: number;
  length: number;
  data: {
    text?: string;
    url?: string;
    title?: string;
  };
}

function isSafeUrl(url: string): boolean {
  if (!url) return false;
  let sanitized = url.trim().toLowerCase().replace(/[\x00-\x20\s]+/g, "");
  for (let iter = 0; iter < 3; iter++) {
    try {
      const next = decodeURIComponent(sanitized).replace(/[\x00-\x20\s]+/g, "");
      if (next === sanitized) break;
      sanitized = next;
    } catch {
      break;
    }
  }
  if (
    sanitized.startsWith("javascript:") ||
    sanitized.startsWith("vbscript:") ||
    sanitized.startsWith("data:") ||
    sanitized.startsWith("blob:")
  ) {
    return false;
  }
  return true;
}

function findNextInlineToken(text: string, allowLinks = true): InlineMatch | null {
  const matches: InlineMatch[] = [];

  // 1. Inline code: `code` or ``code``
  const codeRe = /(`+)([^\n]+?)\1/g;
  let m = codeRe.exec(text);
  if (m) {
    let codeContent = m[2];
    if (codeContent.startsWith(" ") && codeContent.endsWith(" ") && codeContent.trim().length > 0) {
      codeContent = codeContent.slice(1, -1);
    }
    matches.push({
      type: "code",
      index: m.index,
      length: m[0].length,
      data: { text: codeContent },
    });
  }

  if (allowLinks) {
    // 2. Markdown Link: [text](url "optional title") with balanced parenthesis, angle brackets, code spans in label, and escaped bracket support
    const linkRe = /\[((?:`+[^`\n]*`+|\\\]|\[[^\]\n]*\]|[^\]\n])*)\]\(\s*(?:<([^>\n]+)>|((?:\([^\s)]*\)|[^\s)"'])+))(?:\s+["']([^"']*)["'])?\s*\)/g;
    m = linkRe.exec(text);
    if (m) {
      const rawUrl = m[2] !== undefined ? m[2] : m[3];
      const title = m[4];
      const labelText = m[1].replace(/\\([\[\]])/g, "$1");
      matches.push({
        type: "link",
        index: m.index,
        length: m[0].length,
        data: { text: labelText, url: rawUrl, title },
      });
    }

    // 3. Autolink in angle brackets: <https://...> or <email@domain.com>
    const autoRe = /<((?:https?:\/\/|mailto:)[^>\s]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g;
    m = autoRe.exec(text);
    if (m) {
      let dest = m[1];
      if (!dest.startsWith("http://") && !dest.startsWith("https://") && !dest.startsWith("mailto:")) {
        dest = "mailto:" + dest;
      }
      matches.push({
        type: "autolink",
        index: m.index,
        length: m[0].length,
        data: { url: dest, text: m[1] },
      });
    }
  }

  // 4. Strikethrough: ~~text~~ (no inner edge whitespace)
  const strikeRe = /~~([^\s\n](?:[^\n]*?[^\s\n])?)~~/g;
  m = strikeRe.exec(text);
  if (m) {
    matches.push({
      type: "strike",
      index: m.index,
      length: m[0].length,
      data: { text: m[1] },
    });
  }

  // 5. Bold Italic: ***text*** or ___text___ (supports nested emphasis, no inner edge whitespace)
  const boldItalicRe = /(?<!\*)\*\*\*(?!\*)([^\s\n](?:[^\n]*?[^\s\n])?)(?<!\*)\*\*\*(?!\*)|(?<=^|[^\w])___(?!_)([^\s\n](?:[^\n]*?[^\s\n])?)(?<!_)___(?=[^\w]|$)/g;
  m = boldItalicRe.exec(text);
  if (m) {
    matches.push({
      type: "bolditalic",
      index: m.index,
      length: m[0].length,
      data: { text: m[1] || m[2] },
    });
  }

  // 6. Bold: **text** or __text__ (supports nested emphasis, no inner edge whitespace)
  const boldRe = /(?<!\*)\*\*(?!\*)([^\s\n](?:[^\n]*?[^\s\n])?)(?<!\*)\*\*(?!\*)|(?<=^|[^\w])__(?!_)([^\s\n](?:[^\n]*?[^\s\n])?)(?<!_)__(?=[^\w]|$)/g;
  m = boldRe.exec(text);
  if (m) {
    matches.push({
      type: "bold",
      index: m.index,
      length: m[0].length,
      data: { text: m[1] || m[2] },
    });
  }

  // 7. Italic: *text* or _text_ (supports nested emphasis, no inner edge whitespace, preserves snake_case)
  const italicRe = /(?<!\*)\*(?!\*)([^\s\n](?:[^\n]*?[^\s\n])?)(?<!\*)\*(?!\*)|(?<=^|[^\w])_(?!_)([^\s\n](?:[^\n]*?[^\s\n])?)(?<!_)_(?=[^\w]|$)/g;
  m = italicRe.exec(text);
  if (m) {
    matches.push({
      type: "italic",
      index: m.index,
      length: m[0].length,
      data: { text: m[1] || m[2] },
    });
  }

  if (allowLinks) {
    // 8. Standalone URL: https://... (balances trailing parentheses per GFM Section 6.9, excludes surrounding quotes)
    const urlRe = /\b(https?:\/\/[^\s<>"']+)/g;
    m = urlRe.exec(text);
    if (m) {
      let rawUrl = m[1];
      rawUrl = rawUrl.replace(/[.,:;?!'"]+$/, "");
      while (rawUrl.endsWith(")")) {
        const openCount = (rawUrl.match(/\(/g) || []).length;
        const closeCount = (rawUrl.match(/\)/g) || []).length;
        if (closeCount > openCount) {
          rawUrl = rawUrl.slice(0, -1);
          rawUrl = rawUrl.replace(/[.,:;?!'"]+$/, "");
        } else {
          break;
        }
      }
      matches.push({
        type: "autolink",
        index: m.index,
        length: rawUrl.length,
        data: { url: rawUrl },
      });
    }

    // 9. Standalone www autolink: www.example.com (GFM Section 6.6, excludes surrounding quotes)
    const wwwRe = /\b(www\.[^\s<>"']+)/g;
    m = wwwRe.exec(text);
    if (m) {
      let rawUrl = m[1];
      rawUrl = rawUrl.replace(/[.,:;?!'"]+$/, "");
      while (rawUrl.endsWith(")")) {
        const openCount = (rawUrl.match(/\(/g) || []).length;
        const closeCount = (rawUrl.match(/\)/g) || []).length;
        if (closeCount > openCount) {
          rawUrl = rawUrl.slice(0, -1);
          rawUrl = rawUrl.replace(/[.,:;?!'"]+$/, "");
        } else {
          break;
        }
      }
      matches.push({
        type: "autolink",
        index: m.index,
        length: rawUrl.length,
        data: { url: "https://" + rawUrl, text: rawUrl },
      });
    }

    // 10. Standalone email autolink: user@domain.com (GFM Section 6.8, excludes surrounding quotes)
    const emailRe = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
    m = emailRe.exec(text);
    if (m) {
      let rawEmail = m[1].replace(/[.,:;?!'"]+$/, "");
      matches.push({
        type: "autolink",
        index: m.index,
        length: rawEmail.length,
        data: { url: "mailto:" + rawEmail, text: rawEmail },
      });
    }
  }

  if (matches.length === 0) return null;

  // Pick match with lowest index, then longest length
  matches.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return b.length - a.length;
  });

  return matches[0];
}

export function renderInlineMarkdown(
  text: string,
  keyPrefix = "inl",
  depth = 0,
  allowLinks = true
): React.ReactNode {
  if (!text) return null;
  if (depth > 10) return text; // recursion guard

  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let k = 0;

  while (remaining.length > 0) {
    const match = findNextInlineToken(remaining, allowLinks);
    if (!match) {
      nodes.push(remaining);
      break;
    }

    if (match.index > 0) {
      nodes.push(remaining.slice(0, match.index));
    }

    const key = `${keyPrefix}-${k++}`;
    const tokenText = match.data.text || "";
    const tokenUrl = match.data.url || "";

    switch (match.type) {
      case "code":
        nodes.push(
          <code
            key={key}
            className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] text-neutral-900 border border-neutral-200/70"
          >
            {tokenText}
          </code>
        );
        break;

      case "link": {
        const safe = isSafeUrl(tokenUrl);
        const effectiveUrl = safe ? tokenUrl : "#";
        const tokenTitle = match.data.title;
        const isExternal =
          effectiveUrl.startsWith("http://") ||
          effectiveUrl.startsWith("https://") ||
          effectiveUrl.startsWith("//") ||
          effectiveUrl.startsWith("mailto:") ||
          effectiveUrl.startsWith("ftp:") ||
          effectiveUrl.startsWith("tel:");

        if (isExternal) {
          nodes.push(
            <a
              key={key}
              href={effectiveUrl}
              title={tokenTitle}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-700 hover:text-blue-900 underline underline-offset-[0.18em] decoration-blue-600/40 hover:decoration-blue-800 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 rounded-sm break-words"
            >
              {renderInlineMarkdown(tokenText, `${key}-lnk`, depth + 1, false)}
            </a>
          );
        } else {
          nodes.push(
            <Link
              key={key}
              href={effectiveUrl}
              title={tokenTitle}
              className="font-medium text-blue-700 hover:text-blue-900 underline underline-offset-[0.18em] decoration-blue-600/40 hover:decoration-blue-800 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 rounded-sm break-words"
            >
              {renderInlineMarkdown(tokenText, `${key}-lnk`, depth + 1, false)}
            </Link>
          );
        }
        break;
      }

      case "autolink": {
        const safe = isSafeUrl(tokenUrl);
        const effectiveUrl = safe ? tokenUrl : "#";
        nodes.push(
          <a
            key={key}
            href={effectiveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-700 hover:text-blue-900 underline underline-offset-[0.18em] decoration-blue-600/40 hover:decoration-blue-800 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 rounded-sm break-all"
          >
            {match.data.text || tokenUrl}
          </a>
        );
        break;
      }

      case "strike":
        nodes.push(
          <del key={key} className="line-through text-neutral-400">
            {renderInlineMarkdown(tokenText, `${key}-stk`, depth + 1, allowLinks)}
          </del>
        );
        break;

      case "bolditalic":
        nodes.push(
          <strong key={key} className="font-semibold text-neutral-950">
            <em className="italic">
              {renderInlineMarkdown(tokenText, `${key}-bi`, depth + 1, allowLinks)}
            </em>
          </strong>
        );
        break;

      case "bold":
        nodes.push(
          <strong key={key} className="font-semibold text-neutral-950">
            {renderInlineMarkdown(tokenText, `${key}-b`, depth + 1, allowLinks)}
          </strong>
        );
        break;

      case "italic":
        nodes.push(
          <em key={key} className="italic text-neutral-800">
            {renderInlineMarkdown(tokenText, `${key}-i`, depth + 1, allowLinks)}
          </em>
        );
        break;
    }

    remaining = remaining.slice(match.index + match.length);
  }

  return nodes.length === 1 ? nodes[0] : <React.Fragment>{nodes}</React.Fragment>;
}

function CodeContainer({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {});
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3.5 py-2 text-[11px] font-mono text-neutral-300">
        <span className="font-medium uppercase tracking-[0.06em] text-neutral-300">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code snippet"
          className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-white active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          {copied ? (
            <>
              <IconCheck className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <span>Copy</span>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto no-scrollbar p-3.5 font-mono text-xs leading-relaxed text-neutral-100 selection:bg-blue-500/30">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function splitTableRow(row: string): string[] {
  let trimmed = row.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (/(?<!\\)(?:\\\\)*\|$/.test(trimmed)) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  let inCodeSpan = false;
  let codeSpanDelimiter = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    // Escaped pipe \| or backslash \\
    if (char === "\\") {
      if (i + 1 < trimmed.length && trimmed[i + 1] === "|") {
        current += "|";
        i++;
        continue;
      }
      if (i + 1 < trimmed.length && trimmed[i + 1] === "\\") {
        current += "\\";
        i++;
        continue;
      }
      current += "\\";
      continue;
    }

    // Inline code span tracking (`code` or ``code``) - do not split on pipes within code
    if (char === "`") {
      let tickCount = 1;
      while (i + 1 < trimmed.length && trimmed[i + 1] === "`") {
        tickCount++;
        i++;
      }
      const ticks = "`".repeat(tickCount);
      current += ticks;
      if (!inCodeSpan) {
        const rest = trimmed.slice(i + 1);
        if (rest.includes(ticks)) {
          inCodeSpan = true;
          codeSpanDelimiter = ticks;
        }
      } else if (codeSpanDelimiter === ticks) {
        inCodeSpan = false;
        codeSpanDelimiter = "";
      }
      continue;
    }

    if (char === "|" && !inCodeSpan) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) return false;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

export function renderChatMarkdown(content: string): React.ReactNode {
  const lines = (content || "").split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let keyIdx = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced code blocks
    const fenceMatch = line.trim().match(/^(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2].trim();
      const codeLines: string[] = [];
      const closeRe = new RegExp("^" + fence[0] + "{" + fence.length + ",}\\s*$");
      i++;
      while (i < lines.length && !closeRe.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // Consume closing fence
      nodes.push(
        <CodeContainer
          key={keyIdx++}
          code={codeLines.join("\n")}
          language={lang}
        />
      );
      continue;
    }

    // Skip empty lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // 2. GFM Tables
    if (
      line.trim().includes("|") &&
      !line.trim().startsWith("```") &&
      !line.trim().startsWith("~~~") &&
      !line.trim().startsWith(">") &&
      !/^\s{0,3}#{1,6}(?:\s+|$)/.test(line) &&
      !/^\s*[-*+]\s+/.test(line) &&
      !/^\s*\d+[.)]\s+/.test(line) &&
      i + 1 < lines.length &&
      isTableDelimiter(lines[i + 1])
    ) {
      const headers = splitTableRow(lines[i]);
      const alignRow = splitTableRow(lines[i + 1]);
      const alignments = alignRow.map((c) => {
        const s = c.trim();
        if (s.startsWith(":") && s.endsWith(":")) return "center";
        if (s.endsWith(":")) return "right";
        return "left";
      });

      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (
          !rowLine ||
          !rowLine.includes("|") ||
          rowLine.startsWith("```") ||
          rowLine.startsWith("~~~") ||
          rowLine.startsWith(">") ||
          /^(?:-[ \t]*){3,}$|^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(rowLine) ||
          /^\s{0,3}#{1,6}(?:\s+|$)/.test(rowLine) ||
          /^[-*+]\s+/.test(rowLine) ||
          /^\d+[.)]\s+/.test(rowLine) ||
          isTableDelimiter(rowLine) ||
          (i + 1 < lines.length && isTableDelimiter(lines[i + 1]))
        ) {
          break;
        }
        rows.push(splitTableRow(rowLine));
        i++;
      }

      nodes.push(
        <div
          key={keyIdx++}
          className="my-3.5 overflow-x-auto no-scrollbar rounded-xl border border-neutral-200 bg-white"
        >
          <table className="min-w-full divide-y divide-neutral-200 text-[13px] text-neutral-800 border-collapse tabular-nums">
            <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-[0.05em] text-neutral-600">
              <tr>
                {headers.map((h, colIdx) => (
                  <th
                    key={colIdx}
                    className="px-3.5 py-2.5 font-semibold text-neutral-700 whitespace-nowrap"
                    style={{ textAlign: alignments[colIdx] || "left" }}
                  >
                    {renderInlineMarkdown(h, `th-${keyIdx}-${colIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/70 bg-white">
              {rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-neutral-50/80 transition-colors duration-150 ease-out-quart"
                >
                  {headers.map((_, colIdx) => (
                    <td
                      key={colIdx}
                      className="px-3.5 py-2.5 text-neutral-800"
                      style={{ textAlign: alignments[colIdx] || "left" }}
                    >
                      {renderInlineMarkdown(row[colIdx] || "", `td-${keyIdx}-${rowIdx}-${colIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 3. Task lists (- [ ] / - [x])
    if (/^\s*[-*+]\s+\[([ xX])\](?:\s+|$)/.test(line)) {
      const tasks: Array<{ checked: boolean; text: string; indent: number }> = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/);
        if (m) {
          tasks.push({
            indent: m[1].length,
            checked: m[2].toLowerCase() === "x",
            text: m[3],
          });
          i++;
        } else if (
          tasks.length > 0 &&
          /^\s{2,}\S/.test(lines[i]) &&
          !lines[i].trim().match(/^(?:```|~~~|\s{0,3}#{1,6}(?:\s+|$)|[-*+]\s+|\d+[.)]\s+|>|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/)
        ) {
          tasks[tasks.length - 1].text += " " + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      nodes.push(
        <ul key={keyIdx++} className="my-2.5 space-y-1.5 pl-0 list-none">
          {tasks.map((task, tIdx) => (
            <li
              key={tIdx}
              className={`flex items-start gap-2.5 text-sm leading-relaxed text-neutral-800 ${
                task.indent >= 4 ? "ml-6" : task.indent >= 2 ? "ml-3" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={task.checked}
                readOnly
                disabled
                className="mt-1 h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 accent-neutral-950 cursor-default shrink-0"
              />
              <span
                className={
                  task.checked
                    ? "line-through text-neutral-400"
                    : "text-neutral-800"
                }
              >
                {renderInlineMarkdown(task.text, `task-${keyIdx}-${tIdx}`)}
              </span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 4. Headings (# H1 to ###### H6, with optional closing #)
    const headingMatch = line.match(/^\s{0,3}(#{1,6})(?:\s+(.*)|$)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = (headingMatch[2] || "").replace(/\s+#+\s*$/, "");
      let headingCls = "font-semibold text-neutral-950 leading-snug";
      if (level === 1) {
        headingCls += " text-[17px] tracking-[-0.02em] mt-5 mb-2 border-b border-neutral-200 pb-1.5";
      } else if (level === 2) {
        headingCls += " text-[15px] tracking-[-0.015em] mt-4 mb-1.5 border-b border-neutral-200/70 pb-1";
      } else if (level === 3) {
        headingCls += " text-sm tracking-[-0.01em] mt-3.5 mb-1 text-neutral-900";
      } else {
        headingCls += " text-xs uppercase tracking-[0.06em] mt-3 mb-1 text-neutral-700";
      }

      nodes.push(
        <div key={keyIdx++} className={headingCls} role="heading" aria-level={level}>
          {renderInlineMarkdown(headingText, `h-${keyIdx}`)}
        </div>
      );
      i++;
      continue;
    }

    // 5. Horizontal rule
    if (/^(?:-[ \t]*){3,}$|^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(line.trim())) {
      nodes.push(<hr key={keyIdx++} className="my-4 border-neutral-200" />);
      i++;
      continue;
    }

    // 6. Blockquotes
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      nodes.push(
        <blockquote
          key={keyIdx++}
          className="my-2.5 border-l border-neutral-300 pl-3.5 py-0.5 text-[13px] text-neutral-700 leading-relaxed space-y-1"
        >
          {quoteLines.map((ql, qIdx) => (
            <div key={qIdx}>{renderInlineMarkdown(ql, `bq-${keyIdx}-${qIdx}`)}</div>
          ))}
        </blockquote>
      );
      continue;
    }

    // 7. Unordered lists
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Array<{ text: string; indent: number }> = [];
      while (i < lines.length) {
        if (/^(?:-[ \t]*){3,}$|^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(lines[i].trim())) {
          break;
        }
        if (/^\s*[-*+]\s+\[([ xX])\]/.test(lines[i])) {
          break;
        }
        if (/^\s*[-*+]\s+/.test(lines[i])) {
          const indentMatch = lines[i].match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1].length : 0;
          items.push({
            text: lines[i].replace(/^\s*[-*+]\s+/, ""),
            indent,
          });
          i++;
        } else if (
          items.length > 0 &&
          /^\s{2,}\S/.test(lines[i]) &&
          !lines[i].trim().match(/^(?:```|~~~|\s{0,3}#{1,6}(?:\s+|$)|[-*+]\s+|\d+[.)]\s+|>|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/)
        ) {
          items[items.length - 1].text += " " + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      nodes.push(
        <ul key={keyIdx++} className="my-2.5 list-disc pl-5 space-y-1.5 text-sm text-neutral-800 leading-relaxed">
          {items.map((item, li) => (
            <li
              key={li}
              className={
                item.indent >= 4
                  ? "ml-4 list-[circle] text-neutral-700"
                  : item.indent >= 2
                  ? "ml-2 list-[square] text-neutral-700"
                  : "text-neutral-800"
              }
            >
              {renderInlineMarkdown(item.text, `ul-${keyIdx}-${li}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 8. Ordered lists
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const startMatch = line.match(/^\s*(\d+)[.)]\s+/);
      const startNumber = startMatch ? parseInt(startMatch[1], 10) : 1;
      const items: Array<{ text: string; isTask: boolean; checked: boolean }> = [];
      while (i < lines.length) {
        if (/^\s*\d+[.)]\s+/.test(lines[i])) {
          const raw = lines[i].replace(/^\s*\d+[.)]\s+/, "");
          const taskMatch = raw.match(/^\[([ xX])\]\s*(.*)$/);
          if (taskMatch) {
            items.push({
              text: taskMatch[2],
              isTask: true,
              checked: taskMatch[1].toLowerCase() === "x",
            });
          } else {
            items.push({
              text: raw,
              isTask: false,
              checked: false,
            });
          }
          i++;
        } else if (
          items.length > 0 &&
          /^\s{2,}\S/.test(lines[i]) &&
          !lines[i].trim().match(/^(?:```|~~~|\s{0,3}#{1,6}(?:\s+|$)|[-*+]\s+|>|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/)
        ) {
          items[items.length - 1].text += " " + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      nodes.push(
        <ol key={keyIdx++} start={startNumber > 1 ? startNumber : undefined} className="my-2.5 list-decimal pl-5 space-y-1.5 text-sm text-neutral-800 leading-relaxed">
          {items.map((item, li) => (
            <li key={li}>
              {item.isTask ? (
                <div className="inline-flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    disabled
                    className="mt-1 h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 accent-neutral-950 cursor-default shrink-0"
                  />
                  <span className={item.checked ? "line-through text-neutral-400" : "text-neutral-800"}>
                    {renderInlineMarkdown(item.text, `ol-task-${keyIdx}-${li}`)}
                  </span>
                </div>
              ) : (
                renderInlineMarkdown(item.text, `ol-${keyIdx}-${li}`)
              )}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 9. Paragraph
    const pLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().match(/^(?:```|~~~|\s{0,3}#{1,6}(?:\s+|$)|[-*+]\s+|\d+[.)]\s+|>|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/) &&
      !(
        lines[i].trim().includes("|") &&
        i + 1 < lines.length &&
        isTableDelimiter(lines[i + 1])
      )
    ) {
      pLines.push(lines[i]);
      i++;
    }

    nodes.push(
      <p key={keyIdx++} className="my-2 leading-relaxed text-neutral-900 text-sm">
        {renderInlineMarkdown(pLines.join(" "), `p-${keyIdx}`)}
      </p>
    );
  }

  return <div className="space-y-1">{nodes}</div>;
}

export function MarkdownPreview({ content, className = "" }: MarkdownPreviewProps) {
  return (
    <div className={`markdown-preview ${className}`}>
      {renderChatMarkdown(content)}
    </div>
  );
}

export default MarkdownPreview;
