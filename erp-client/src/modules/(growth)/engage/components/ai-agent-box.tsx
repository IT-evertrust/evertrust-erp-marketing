'use client';

import { useState } from 'react';

import type { AiAgentMode } from '../types';

type AiAgentBoxProps = {
  mode: AiAgentMode;
  onChangeMode: (mode: AiAgentMode) => void;
  // Write & Fix: revise the current draft per a one-off instruction (slow — LLM).
  onApply: (instruction: string) => Promise<void>;
  // Train · Feedback: persist a note the drafter always applies going forward.
  onSaveTraining: (note: string) => Promise<void>;
  // True while an Apply (re-draft) is running.
  applying?: boolean;
};

export function AiAgentBox({
  mode,
  onChangeMode,
  onApply,
  onSaveTraining,
  applying = false,
}: AiAgentBoxProps) {
  const [writeText, setWriteText] = useState('');
  const [trainText, setTrainText] = useState('');
  const [savingTraining, setSavingTraining] = useState(false);

  async function handleApply() {
    const instruction = writeText.trim();
    if (!instruction || applying) return;
    await onApply(instruction);
    setWriteText('');
  }

  async function handleSaveTraining() {
    const note = trainText.trim();
    if (!note || savingTraining) return;
    setSavingTraining(true);
    try {
      await onSaveTraining(note);
      setTrainText('');
    } finally {
      setSavingTraining(false);
    }
  }

  return (
    <div className="border-t border-border bg-muted">
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => onChangeMode('write')}
          className={[
            'flex-1 px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.04em]',
            mode === 'write'
              ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--foreground)]'
              : 'text-muted-foreground',
          ].join(' ')}
        >
          Write & Fix
        </button>

        <button
          type="button"
          onClick={() => onChangeMode('train')}
          className={[
            'flex-1 px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.04em]',
            mode === 'train'
              ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--foreground)]'
              : 'text-muted-foreground',
          ].join(' ')}
        >
          Train · Feedback
        </button>
      </div>

      <div className="p-3">
        {mode === 'write' ? (
          <div className="flex gap-2">
            <input
              value={writeText}
              onChange={(e) => setWriteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleApply();
              }}
              disabled={applying}
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none disabled:opacity-60"
              placeholder="Ask the AI to write or fix this draft …"
            />
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || !writeText.trim()}
              className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-50"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={trainText}
                onChange={(e) => setTrainText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveTraining();
                }}
                disabled={savingTraining}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none disabled:opacity-60"
                placeholder="Teach the AI, e.g. always quote 4-6 week delivery …"
              />
              <button
                type="button"
                onClick={handleSaveTraining}
                disabled={savingTraining || !trainText.trim()}
                className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-50"
              >
                {savingTraining ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Saved feedback is applied to every future draft for this campaign.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
