import type { ReactNode } from 'react';

type GrowthCardProps = {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  // Extra classes for the body wrapper — e.g. `flex min-h-0 flex-1 flex-col` so a
  // scrolling child fills a fixed-height card instead of overflowing it.
  bodyClassName?: string;
};

export function GrowthCard({
  title,
  hint,
  children,
  className = '',
  bodyClassName = '',
}: GrowthCardProps) {
  return (
    <section
      className={[
        'min-h-0 min-w-0 rounded-[10px] border border-[#e4e7eb] bg-white',
        className,
      ].join(' ')}
    >
      <div className="flex items-center justify-between border-b border-[#e4e7eb] px-4 py-[15px]">
        <h2 className="text-[13.5px] font-bold leading-none text-[#15171c]">
          {title}
        </h2>

        {hint ? (
          <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
            {hint}
          </div>
        ) : null}
      </div>

      <div className={['p-4', bodyClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </section>
  );
}