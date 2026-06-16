import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Column-header accent tones (mockup uses inline `color:var(--accent|amber|rose)`
// on `.col-head`). Default inherits the foreground.
const HEAD_TONES = {
  default: '',
  emerald: 'text-emerald-500',
  sky: 'text-sky-500',
  violet: 'text-violet-500',
  amber: 'text-amber-500',
  rose: 'text-rose-500',
} as const;

export type BoardTone = keyof typeof HEAD_TONES;

// The kanban scroller (mockup `.board`, line 127): a horizontal row of columns
// that scrolls when it overflows. Drop `BoardColumn`s inside.
export function Board({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-3 overflow-x-auto pb-1.5', className)}>
      {children}
    </div>
  );
}

// A single kanban column (mockup `.col` + `.col-head`, lines 128–130): a titled
// surface with an optional count pill in the header. Stacks `BoardCard`s.
export function BoardColumn({
  title,
  count,
  tone = 'default',
  children,
  className,
}: {
  title: ReactNode;
  count?: ReactNode;
  tone?: BoardTone;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-[210px] flex-1 flex-col gap-2.5 rounded-xl border border-border/60 bg-muted p-3',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between text-xs font-bold',
          HEAD_TONES[tone],
        )}
      >
        <span>{title}</span>
        {count != null ? (
          <span className="rounded-full border bg-card px-2 py-px text-[11px] font-medium text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// A draggable-looking card inside a column (mockup `.kcard`, lines 131–138):
// a bold title line, an optional muted subtitle/body, and an optional footer row
// (e.g. a status badge on the left + move controls / a value tag on the right).
export function BoardCard({
  title,
  subtitle,
  footer,
  onClick,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex cursor-grab flex-col gap-1.5 rounded-lg border bg-card p-3 shadow-sm',
        className,
      )}
    >
      <div className="text-xs font-semibold">{title}</div>
      {subtitle ? (
        <div className="text-[11.5px] leading-snug text-muted-foreground">
          {subtitle}
        </div>
      ) : null}
      {footer ? (
        <div className="flex items-center justify-between gap-2">{footer}</div>
      ) : null}
    </div>
  );
}
