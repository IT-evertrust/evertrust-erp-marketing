import type { AiAgentMode } from '../types';

type AiAgentBoxProps = {
  mode: AiAgentMode;
  onChangeMode: (mode: AiAgentMode) => void;
};

export function AiAgentBox({ mode, onChangeMode }: AiAgentBoxProps) {
  return (
    <div className="border-t border-[#e4e7eb] bg-[#f6f7f9]">
      <div className="flex border-b border-[#e4e7eb]">
        <button
          type="button"
          onClick={() => onChangeMode('write')}
          className={[
            'flex-1 px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.04em]',
            mode === 'write'
              ? 'bg-white text-[#15171c] shadow-[inset_0_-2px_0_#15171c]'
              : 'text-[#959ca7]',
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
              ? 'bg-white text-[#15171c] shadow-[inset_0_-2px_0_#15171c]'
              : 'text-[#959ca7]',
          ].join(' ')}
        >
          Train · Feedback
        </button>
      </div>

      <div className="p-3">
        {mode === 'write' ? (
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-[#d6dade] bg-white px-3 py-2 text-[13px] text-[#15171c] outline-none"
              placeholder="Ask the AI to write or fix this draft …"
            />
            <button className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
              Apply
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-[#d6dade] bg-white px-3 py-2 text-[13px] text-[#15171c] outline-none"
                placeholder="Teach the AI, e.g. always quote 4-6 week delivery …"
              />
              <button className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                Save
              </button>
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-[#959ca7]">
              Feedback will later tune future drafts for this campaign and
              sequence.
            </div>
          </>
        )}
      </div>
    </div>
  );
}