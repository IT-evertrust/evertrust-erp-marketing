import type { ReactNode } from 'react';

// Consistent empty state for any list/table with no rows yet. Centered, dashed
// border, optional icon + call-to-action. Use instead of a bare
// "Nothing here" paragraph so empty pages still feel designed.
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      {icon ? (
        <div className="mb-1 text-muted-foreground/50 [&_svg]:size-8">{icon}</div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
