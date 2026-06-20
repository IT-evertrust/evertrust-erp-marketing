'use client';

import { useState } from 'react';

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
      <div className="w-full max-w-[560px] overflow-hidden rounded-[12px] border border-[#d6dade] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#e4e7eb] px-5 py-4">
          <div>
            <h2 className="text-[14px] font-bold text-[#15171c]">
              New Reach Aim
            </h2>
            <p className="mt-1 text-[11px] text-[#959ca7]">
              Define the campaign target before scraping leads.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#959ca7] hover:text-[#15171c]"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-5">
            <Field label="Campaign Name">
              <input
                value={values.name}
                onChange={(event) => updateValue('name', event.target.value)}
                placeholder="e.g. Housing Co-ops ≥ 500 units · Bavaria"
                className="w-full rounded-lg border border-[#d6dade] bg-[#f6f7f9] px-3 py-2.5 text-[13px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Niche">
                <input
                  value={values.niche}
                  onChange={(event) => updateValue('niche', event.target.value)}
                  placeholder="e.g. Housing, Property Mgmt, Installer"
                  className="w-full rounded-lg border border-[#d6dade] bg-[#f6f7f9] px-3 py-2.5 text-[13px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
                />
              </Field>

              <Field label="Region">
                <input
                  value={values.region}
                  onChange={(event) => updateValue('region', event.target.value)}
                  placeholder="e.g. Bavaria, NRW, Nationwide DE"
                  className="w-full rounded-lg border border-[#d6dade] bg-[#f6f7f9] px-3 py-2.5 text-[13px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
                />
              </Field>
            </div>

            <Field label="Segment">
              <input
                value={values.segment}
                onChange={(event) => updateValue('segment', event.target.value)}
                placeholder="e.g. Portfolio holders, public housing, utilities"
                className="w-full rounded-lg border border-[#d6dade] bg-[#f6f7f9] px-3 py-2.5 text-[13px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
              />
            </Field>

            <Field label="Source">
              <input
                value={values.source}
                onChange={(event) => updateValue('source', event.target.value)}
                placeholder="e.g. Company DB, iBau, LinkedIn"
                className="w-full rounded-lg border border-[#d6dade] bg-[#f6f7f9] px-3 py-2.5 text-[13px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
              />
            </Field>

            <Field label="Sender mailbox">
              <input
                value={values.sender}
                onChange={(event) => updateValue('sender', event.target.value)}
                placeholder="info or hanna"
                className="w-full rounded-lg border border-[#d6dade] bg-[#f6f7f9] px-3 py-2.5 text-[13px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 border-t border-[#e4e7eb] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c] disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-60"
            >
              {submitting ? 'Aiming…' : 'Start Aim'}
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
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#959ca7]">
        {label}
      </div>
      {children}
    </label>
  );
}