'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
// Body editor; the keys mirror the stored `ReachTemplates` shape. `labelKey`/
// `hintKey` resolve via next-intl (reach.templates.round.*).
const ROUNDS: Array<{
  key: 'cold_outreach' | 'follow_up' | 'final_push';
  labelKey: 'cold' | 'followUp' | 'final';
}> = [
  { key: 'cold_outreach', labelKey: 'cold' },
  { key: 'follow_up', labelKey: 'followUp' },
  { key: 'final_push', labelKey: 'final' },
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

// Reach · Templates tab. Edits the org-wide default three-round email template
// (the Reach Bazooka's fallback when a campaign has no template of its own) plus
// the org's signature image URL. Saves via the default-template + signature routes.
export function TemplatesEditorPanel() {
  const t = useTranslations('reach');
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
        if (active) toast.error(t('templates.toast.loadFailed'));
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

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
      toast.error(t('templates.toast.invalidJson'));
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      toast.error(t('templates.toast.expectedObject'));
      return;
    }
    const source = parsed as Record<string, unknown>;
    const coldBlock = pickBlock(source, ['cold', 'cold_outreach']);
    const followUpBlock = pickBlock(source, ['followup', 'follow_up']);
    const finalBlock = pickBlock(source, ['finalpush', 'final', 'final_push']);

    if (!coldBlock && !followUpBlock && !finalBlock) {
      toast.error(t('templates.toast.noRounds'));
      return;
    }
    if (coldBlock) setCold(coldBlock);
    if (followUpBlock) setFollowUp(followUpBlock);
    if (finalBlock) setFinalPush(finalBlock);
    toast.success(t('templates.toast.loaded'));
  }

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so the same file can be picked again.
    event.target.value = '';
    if (!file) return;
    void file
      .text()
      .then(fillFromJson)
      .catch(() => toast.error(t('templates.toast.readFailed')));
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
      toast.success(t('templates.toast.saved'));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('templates.toast.saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <GrowthCard title={t('templates.default.title')} hint={t('templates.orgWide')}>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {t('templates.default.intro')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
            {'{{Company}}'}
          </code>
          ,{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
            {'{{Type}}'}
          </code>
          ,{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
            {'{{IndustryFocus}}'}
          </code>{' '}
          {t('templates.default.and')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
            {'{{TenderFocus}}'}
          </code>{' '}
          {t('templates.default.outro')}
        </p>
      </GrowthCard>

      {ROUNDS.map((round) => {
        const block = blocks[round.key];
        return (
          <GrowthCard
            key={round.key}
            title={t(`templates.round.${round.labelKey}.label`)}
            hint={t(`templates.round.${round.labelKey}.hint`)}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${round.key}-subject`}>
                  {t('templates.field.subject')}
                </Label>
                <Input
                  id={`${round.key}-subject`}
                  value={block.subject}
                  onChange={(event) =>
                    updateBlock(round.key, 'subject', event.target.value)
                  }
                  placeholder={t('templates.field.subjectPlaceholder')}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${round.key}-body`}>
                  {t('templates.field.body')}
                </Label>
                <Textarea
                  id={`${round.key}-body`}
                  value={block.body}
                  onChange={(event) =>
                    updateBlock(round.key, 'body', event.target.value)
                  }
                  rows={10}
                  className="font-mono text-[12.5px]"
                  placeholder={t('templates.field.bodyPlaceholder')}
                />
              </div>
            </div>
          </GrowthCard>
        );
      })}

      <GrowthCard
        title={t('templates.import.title')}
        hint={t('templates.optional')}
      >
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-muted-foreground">
            {t('templates.import.intro')}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
              {'{ COLD, FOLLOWUP, FINALPUSH }'}
            </code>{' '}
            {t('templates.import.outro')}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPasteOpen((open) => !open)}
            >
              {pasteOpen
                ? t('templates.import.hidePaste')
                : t('templates.import.pasteJson')}
            </Button>

            <Button asChild variant="outline" size="sm">
              <label className="cursor-pointer">
                {t('templates.import.upload')}
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
                  {t('templates.import.loadFromJson')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </GrowthCard>

      <GrowthCard
        title={t('templates.signature.title')}
        hint={t('templates.optional')}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signature-url">
              {t('templates.signature.urlLabel')}
            </Label>
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
              alt={t('templates.signature.previewAlt')}
              className="max-w-[240px] rounded-md border border-border"
            />
          ) : null}
        </div>
      </GrowthCard>

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t('templates.saving') : t('templates.saveDefault')}
        </Button>
      </div>
    </div>
  );
}
