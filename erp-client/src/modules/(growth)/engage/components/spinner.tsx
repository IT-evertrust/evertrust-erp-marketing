// Small inline loading spinner used across Engage while DB-backed data is in flight.
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-6 text-[12px] font-bold text-[#959ca7]">
      <svg
        className="h-4 w-4 animate-spin text-[#15171c]"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
