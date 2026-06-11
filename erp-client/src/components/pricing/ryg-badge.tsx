import type { RygFlag } from '@evertrust/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RYG_BADGE_CLASS, RYG_LABEL } from '@/lib/pricing-format';

// Color-coded Red/Yellow/Green pricing flag. GREEN = price backed by real
// quotes, YELLOW = mixed evidence, RED = estimate-only / no evidence. Reads its
// palette from RYG_BADGE_CLASS so the same colors are used wherever it appears.
export function RygBadge({
  ryg,
  className,
}: {
  ryg: RygFlag;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      title={ryg}
      className={cn(
        'size-5 justify-center rounded-full p-0 font-semibold',
        RYG_BADGE_CLASS[ryg],
        className,
      )}
    >
      {RYG_LABEL[ryg]}
    </Badge>
  );
}
