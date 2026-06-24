// The ONE loading indicator for the whole growth app — a spinning circular topper.
// Every loading state (panel placeholders, list loaders, in-flight buttons) routes
// through this so the app has a single, consistent loading UI.
//
//   <Spinner label="Loading meetings…" />     → centered block placeholder
//   <Spinner inline size={14} />              → bare icon for buttons / inline use
type SpinnerProps = {
  label?: string;
  // Icon size in px (default 24 for block placeholders; use ~14 inline in buttons).
  size?: number;
  // Render just the spinning icon (no centered block / padding) — for inline/button use.
  inline?: boolean;
  className?: string;
};

export function Spinner({
  label,
  size = 24,
  inline = false,
  className = '',
}: SpinnerProps) {
  const icon = (
    <svg
      // Inline spinners inherit the parent's text color (so they read on dark buttons);
      // block placeholders use the dark ink.
      className={['animate-spin', inline ? '' : 'text-[#15171c]'].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );

  if (inline) {
    if (!label) return icon;
    return (
      <span className={['inline-flex items-center gap-2', className].join(' ')}>
        {icon}
        {label}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'flex flex-col items-center justify-center gap-3 p-8 text-[12.5px] font-bold text-[#959ca7]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
      {label ? <span>{label}</span> : null}
    </div>
  );
}
