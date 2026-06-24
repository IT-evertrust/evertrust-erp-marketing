'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { GrowthCard } from '../../shared';

import {
  getDefaultTemplate,
  getSignature,
  setDefaultTemplate,
  setSignature,
} from '../services/reach.service';
import type { EmailBlock } from '../types';

const EMPTY_BLOCK: EmailBlock = { subject: '', body: '' };

// The three rounds the Reach Bazooka sends, in order. Each renders a Subject +
// Body editor; the keys mirror the stored `ReachTemplates` shape.
const ROUNDS: Array<{
  key: 'cold_outreach' | 'follow_up' | 'final_push';
  label: string;
  hint: string;
}> = [
  { key: 'cold_outreach', label: 'Cold outreach', hint: 'Round 1' },
  { key: 'follow_up', label: 'Follow-up', hint: 'Round 2' },
  { key: 'final_push', label: 'Final push', hint: 'Round 3' },
];

// Map an arbitrary parsed JSON object onto our three rounds. Accepts the pasted
// { COLD, FOLLOWUP, FINALPUSH } shape and the stored keys, case-insensitively.
function pickBlock(
  source: Record<string, unknown>,
  aliases: string[],
): EmailBlock | null {
  const entries = Object.entries(source);
  for (const alias of aliases) {
    const match = entries.find(([k]) => k.toLowerCase() === alias);
    const value = match?.[1];
    if (value && typeof value === 'object') {
      const block = value as { subject?: unknown; body?: unknown };
      return {
        subject: typeof block.subject === 'string' ? block.subject : '',
        body: typeof block.body === 'string' ? block.body : '',
      };
    }
  }
  return null;
}

export function TemplatesEditorPanel() {
  const [cold, setCold] = useState<EmailBlock>({ ...EMPTY_BLOCK });
  const [followUp, setFollowUp] = useState<EmailBlock>({ ...EMPTY_BLOCK });
  const [finalPush, setFinalPush] = useState<EmailBlock>({ ...EMPTY_BLOCK });
  const [signatureUrl, setSignatureUrl] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteJson, setPasteJson] = useState('');
  const [saving, setSaving] = useState(false);

  const setters = {
    cold_outreach: setCold,
    follow_up: setFollowUp,
    final_push: setFinalPush,
  } as const;
  const blocks = {
    cold_outreach: cold,
    follow_up: followUp,
    final_push: finalPush,
  } as const;

  // Load the org's default template + signature on mount.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [template, signature] = await Promise.all([
          getDefaultTemplate(),
          getSignature(),
        ]);
        if (!active) return;
        if (template) {
          setCold(template.cold_outreach ?? { ...EMPTY_BLOCK });
          setFollowUp(template.follow_up ?? { ...EMPTY_BLOCK });
          setFinalPush(template.final_push ?? { ...EMPTY_BLOCK });
        }
        setSignatureUrl(signature.signatureImageUrl ?? '');
      } catch {
        if (active) toast.error('Could not load the default template.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function updateBlock(
    key: keyof typeof setters,
    field: keyof EmailBlock,
    value: string,
  ) {
    setters[key]((current) => ({ ...current, [field]: value }));
  }

  // Parse a pasted/uploaded JSON object and fill the three round fields.
  function fillFromJson(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast.error('Invalid JSON — could not parse the template.');
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      toast.error('Expected a JSON object with the three rounds.');
      return;
    }
    const source = parsed as Record<string, unknown>;
    const coldBlock = pickBlock(source, ['cold', 'cold_outreach']);
    const followUpBlock = pickBlock(source, ['followup', 'follow_up']);
    const finalBlock = pickBlock(source, ['finalpush', 'final', 'final_push']);

    if (!coldBlock && !followUpBlock && !finalBlock) {
      toast.error('No COLD / FOLLOWUP / FINALPUSH rounds found in the JSON.');
      return;
    }
    if (coldBlock) setCold(coldBlock);
    if (followUpBlock) setFollowUp(followUpBlock);
    if (finalBlock) setFinalPush(finalBlock);
    toast.success('Loaded template from JSON.');
  }

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so the same file can be picked again.
    event.target.value = '';
    if (!file) return;
    void file
      .text()
      .then(fillFromJson)
      .catch(() => toast.error('Could not read the uploaded file.'));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await setDefaultTemplate({
        cold_outreach: cold,
        follow_up: followUp,
        final_push: finalPush,
      });
      await setSignature(signatureUrl.trim() || null);
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <GrowthCard title="Default email template" hint="ORG-WIDE">
        <p className="text-[12.5px] leading-relaxed text-[#5b626d]">
          The org-wide default the Reach Bazooka sends when a campaign has no
          template of its own. Use the placeholders{' '}
          <code className="rounded bg-[#f0f1f3] px-1 py-0.5 text-[11px] text-[#15171c]">
            {'{{Company}}'}
          </code>
          ,{' '}
          <code className="rounded bg-[#f0f1f3] px-1 py-0.5 text-[11px] text-[#15171c]">
            {'{{Type}}'}
          </code>
          ,{' '}
          <code className="rounded bg-[#f0f1f3] px-1 py-0.5 text-[11px] text-[#15171c]">
            {'{{IndustryFocus}}'}
          </code>{' '}
          and{' '}
          <code className="rounded bg-[#f0f1f3] px-1 py-0.5 text-[11px] text-[#15171c]">
            {'{{TenderFocus}}'}
          </code>{' '}
          to personalise each send.
        </p>
      </GrowthCard>

      {ROUNDS.map((round) => {
        const block = blocks[round.key];
        return (
          <GrowthCard key={round.key} title={round.label} hint={round.hint}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${round.key}-subject`}>Subject</Label>
                <Input
                  id={`${round.key}-subject`}
                  value={block.subject}
                  onChange={(event) =>
                    updateBlock(round.key, 'subject', event.target.value)
                  }
                  placeholder="Subject line"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${round.key}-body`}>Body</Label>
                <Textarea
                  id={`${round.key}-body`}
                  value={block.body}
                  onChange={(event) =>
                    updateBlock(round.key, 'body', event.target.value)
                  }
                  rows={10}
                  className="font-mono text-[12.5px]"
                  placeholder="Email body…"
                />
              </div>
            </div>
          </GrowthCard>
        );
      })}

      <GrowthCard title="Import from JSON" hint="OPTIONAL">
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-[#5b626d]">
            Paste or upload a{' '}
            <code className="rounded bg-[#f0f1f3] px-1 py-0.5 text-[11px] text-[#15171c]">
              {'{ COLD, FOLLOWUP, FINALPUSH }'}
            </code>{' '}
            object (stored keys also work) to fill the three rounds above.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPasteOpen((open) => !open)}
            >
              {pasteOpen ? 'Hide paste' : 'Paste JSON'}
            </Button>

            <Button asChild variant="outline" size="sm">
              <label className="cursor-pointer">
                Upload .json
                <input
                  type="file"
                  accept="application/json"
                  onChange={handleUpload}
                  className="hidden"
                />
              </label>
            </Button>
          </div>

          {pasteOpen ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={pasteJson}
                onChange={(event) => setPasteJson(event.target.value)}
                rows={8}
                className="font-mono text-[12.5px]"
                placeholder='{ "COLD": { "subject": "…", "body": "…" }, "FOLLOWUP": { … }, "FINALPUSH": { … } }'
              />
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fillFromJson(pasteJson)}
                >
                  Load from JSON
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </GrowthCard>

      <GrowthCard title="Signature image" hint="OPTIONAL">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signature-url">Signature image URL</Label>
            <Input
              id="signature-url"
              value={signatureUrl}
              onChange={(event) => setSignatureUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>

          {signatureUrl.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={signatureUrl.trim()}
              alt="Signature preview"
              className="max-w-[240px] rounded-md border border-[#e4e7eb]"
            />
          ) : null}
        </div>
      </GrowthCard>

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save as default'}
        </Button>
      </div>
    </div>
  );
}
