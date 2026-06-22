import type { AiAgentMode } from '../types';

type AiAgentBoxProps = {
  mode: AiAgentMode;
  onChangeMode: (mode: AiAgentMode) => void;
};

export function AiAgentBox({ mode, onChangeMode }: AiAgentBoxProps) {
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
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none"
              placeholder="Ask the AI to write or fix this draft …"
            />
            <button className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background">
              Apply
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none"
                placeholder="Teach the AI, e.g. always quote 4-6 week delivery …"
              />
              <button className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background">
                Save
              </button>
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Feedback will later tune future drafts for this campaign and
              sequence.
            </div>
          </>
        )}
      </div>
    </div>
  );
}