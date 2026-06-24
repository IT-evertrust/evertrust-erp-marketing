'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { getEngagePersona } from '../services/engage.service';

// A small modal for creating OR editing a drafting persona (the "+" / pencil beside the
// Draft-persona toggle). Captures a name + the voice/style rules the drafter writes in.
// In edit mode it loads the persona's current rules so they can be extended. On save it
// calls onSubmit (which persists, and re-drafts in that voice when relevant). Themed with
// the app's semantic tokens so it reads correctly on the dark cockpit shell.
type PersonaDialogProps = {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  // Required in edit mode — the persona being edited (its rules are fetched on open).
  personaId?: string | null;
  initialName?: string;
  onSubmit: (name: string, rules: string) => Promise<boolean>;
};

const RULES_PLACEHOLDER = `e.g. Write like Hanna: decisive and warm, never apologetic. No "sorry" / "unfortunately". Use "we" for company actions. Max 3 sentences per paragraph, one clear ask. Mirror the prospect's language (German if they wrote in German). Sign off "Kind regards, Hanna Nguyen — EVERTRUST GmbH".`;

export function PersonaDialog({
  open,
  onClose,
  mode,
  personaId = null,
  initialName = '',
  onSubmit,
}: PersonaDialogProps) {
  const [name, setName] = useState('');
  const [rules, setRules] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // On open: reset for create, or fetch the current name + rules for edit.
  useEffect(() => {
    if (!open) return;
    if (mode === 'create' || !personaId) {
      setName('');
      setRules('');
      return;
    }
    setName(initialName);
    setRules('');
    setLoading(true);
    let active = true;
    getEngagePersona(personaId)
      .then((p) => {
        if (!active) return;
        setName(p.name);
        setRules(p.rules);
      })
      .catch((err: unknown) => {
        if (active) {
          toast.error(
            err instanceof Error ? err.message : 'Could not load the persona.',
          );
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, mode, personaId, initialName]);

  if (!open) return null;

  const isEdit = mode === 'edit';

  async function handleSave() {
    if (!name.trim() || !rules.trim() || saving) return;
    setSaving(true);
    const ok = await onSubmit(name.trim(), rules.trim());
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-[14px] border border-border bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-[15px] font-bold text-foreground">
          {isEdit ? 'Edit draft persona' : 'New draft persona'}
        </div>
        <div className="mt-1 text-[12px] text-muted-foreground">
          {isEdit
            ? 'Adjust the name or extend the rules its replies follow. Replies in campaigns using this persona will be re-drafted in the updated voice.'
            : 'Give the persona a name and the rules its replies should follow. New and existing replies in this campaign will be re-drafted in this voice.'}
        </div>

        <label className="mt-4 block text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Persona name
        </label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Hanna Nguyen"
          maxLength={120}
          disabled={loading}
          className="mt-1 w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground disabled:opacity-50"
        />

        <label className="mt-3 block text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Voice & rules
        </label>
        <textarea
          value={rules}
          onChange={(event) => setRules(event.target.value)}
          placeholder={loading ? 'Loading current rules…' : RULES_PLACEHOLDER}
          rows={10}
          maxLength={8000}
          disabled={loading}
          className="mt-1 w-full resize-y rounded-[8px] border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed text-foreground outline-none focus:border-foreground disabled:opacity-50"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !name.trim() || !rules.trim()}
            className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create persona'}
          </button>
        </div>
      </div>
    </div>
  );
}
