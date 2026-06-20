import type { ReactNode } from 'react';

type GrowthCardProps = {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function GrowthCard({
  title,
  hint,
  children,
  className = '',
}: GrowthCardProps) {
  return (
    <section
      className={[
        'gc-card min-w-0 rounded-[10px] border border-[#e4e7eb] bg-white',
        'duration-300 animate-in fade-in slide-in-from-bottom-1',
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

      <div className="p-4">{children}</div>
    </section>
  );
}