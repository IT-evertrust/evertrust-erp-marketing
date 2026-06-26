'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Plus, Trash2, X } from 'lucide-react';

import {
  deleteKnowledge,
  listKnowledge,
  uploadKnowledge,
  type KnowledgeDoc,
} from '../services/engage.service';

// File types the uploader accepts (mirrors the server's allowed set: PDF, Word .docx,
// text, Markdown, CSV). The browser uses this to filter the OS file picker.
const ACCEPT =
  '.pdf,.docx,.txt,.md,.markdown,.csv,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'text/plain,text/markdown,text/csv';

function statusTone(status: string): string {
  if (status === 'READY') return 'text-foreground';
  if (status === 'NO_TEXT') return 'text-amber-600';
  return 'text-destructive';
}

function statusLabel(status: string): string {
  if (status === 'READY') return 'Indexed';
  if (status === 'NO_TEXT') return 'No text found';
  return 'Extract failed';
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The Engage knowledge base UI: an "Add new company resource" uploader plus a manage
// dialog listing the org's uploaded documents. The reply drafter full-text-searches
// these and grounds (and cites) UNSURE replies on the matches. Lives in the Reply Sorter
// header next to Scan.
export function CompanyResources() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listKnowledge()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setUploading(true);
    try {
      const doc = await uploadKnowledge(file);
      if (doc.status === 'READY') {
        toast.success(`Added "${doc.filename}" to the knowledge base.`);
      } else if (doc.status === 'NO_TEXT') {
        toast.warning(`Stored "${doc.filename}", but no text could be extracted.`);
      } else {
        toast.error(`Stored "${doc.filename}", but text extraction failed.`);
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function onRemove(doc: KnowledgeDoc) {
    if (!window.confirm(`Remove "${doc.filename}" from the knowledge base?`)) return;
    setRemovingId(doc.id);
    try {
      await deleteKnowledge(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success('Resource removed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove resource.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Upload a company document the AI will use to answer unsure replies"
        className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-card px-[11px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Plus className="size-3.5" />
        )}
        {uploading ? 'Uploading…' : 'Add new company resource'}
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Manage company resources"
        className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-card px-[10px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
      >
        <FileText className="size-3.5" />
        {docs.length}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-[12px] border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[14px] font-bold text-foreground">
                  Company resources
                </h2>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  Documents the AI searches to ground unsure replies (PDF, Word, text,
                  CSV).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {docs.length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-muted-foreground">
                  No company resources yet. Upload a document to ground the AI&apos;s
                  unsure replies.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {docs.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[12.5px] font-medium text-foreground">
                            {doc.filename}
                          </span>
                          <span className="text-[10.5px] text-muted-foreground">
                            <span className={statusTone(doc.status)}>
                              {statusLabel(doc.status)}
                            </span>
                            {' · '}
                            {prettyBytes(doc.sizeBytes)}
                            {doc.status === 'READY'
                              ? ` · ${doc.chars.toLocaleString()} chars`
                              : ''}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemove(doc)}
                        disabled={removingId === doc.id}
                        aria-label={`Remove ${doc.filename}`}
                        title={`Remove ${doc.filename}`}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
                      >
                        {removingId === doc.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-card px-3 py-2 text-[12px] font-semibold text-foreground transition-colors hover:border-foreground disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {uploading ? 'Uploading…' : 'Add new company resource'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
