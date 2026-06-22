'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { NewCampaignFormValues } from '../types';

type NewCampaignModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: NewCampaignFormValues) => void;
  submitting?: boolean;
};

export function NewCampaignModal({
  open,
  onClose,
  onSubmit,
  submitting = false,
}: NewCampaignModalProps) {
  const t = useTranslations('reach');
  const [values, setValues] = useState<NewCampaignFormValues>({
    name: '',
    niche: 'Housing',
    region: 'Bavaria',
    segment: '',
    source: 'Company DB',
    sender: 'info',
  });

  if (!open) return null;

  function updateValue<K extends keyof NewCampaignFormValues>(
    key: K,
    value: NewCampaignFormValues[K],
  ) {
    setValues((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!values.name.trim()) return;

    onSubmit({
      ...values,
      name: values.name.trim(),
      segment: values.segment.trim(),
    });

    setValues({
      name: '',
      niche: 'Housing',
      region: 'Bavaria',
      segment: '',
      source: 'Company DB',
      sender: 'info',
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-5">
      <div className="w-full max-w-[560px] overflow-hidden rounded-[12px] border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[14px] font-bold text-foreground">
              {t('modal.title')}
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('modal.description')}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground"
          >
            {t('modal.close')}
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-5">
            <Field label={t('modal.field.name')}>
              <input
                value={values.name}
                onChange={(event) => updateValue('name', event.target.value)}
                placeholder={t('modal.field.namePlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-foreground focus:bg-card"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={t('modal.field.niche')}>
                <input
                  value={values.niche}
                  onChange={(event) => updateValue('niche', event.target.value)}
                  placeholder={t('modal.field.nichePlaceholder')}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-foreground focus:bg-card"
                />
              </Field>

              <Field label={t('modal.field.region')}>
                <input
                  value={values.region}
                  onChange={(event) => updateValue('region', event.target.value)}
                  placeholder={t('modal.field.regionPlaceholder')}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-foreground focus:bg-card"
                />
              </Field>
            </div>

            <Field label={t('modal.field.segment')}>
              <input
                value={values.segment}
                onChange={(event) => updateValue('segment', event.target.value)}
                placeholder={t('modal.field.segmentPlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-foreground focus:bg-card"
              />
            </Field>

            <Field label={t('modal.field.source')}>
              <input
                value={values.source}
                onChange={(event) => updateValue('source', event.target.value)}
                placeholder={t('modal.field.sourcePlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-foreground focus:bg-card"
              />
            </Field>

            <Field label={t('modal.field.sender')}>
              <input
                value={values.sender}
                onChange={(event) => updateValue('sender', event.target.value)}
                placeholder={t('modal.field.senderPlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-foreground focus:bg-card"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground disabled:opacity-50"
            >
              {t('modal.cancel')}
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-60"
            >
              {submitting ? t('modal.submitting') : t('modal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}