type StatusPillProps = {
  children: React.ReactNode;
  live?: boolean;
};

export function StatusPill({ children, live = false }: StatusPillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#5b626d]">
      <span
        className={[
          'h-1.5 w-1.5 rounded-full',
          live ? 'bg-[#15171c]' : 'bg-[#959ca7]',
        ].join(' ')}
      />
      {children}
    </span>
  );
}