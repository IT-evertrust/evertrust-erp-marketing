import type { TenderStatus } from '@evertrust/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUS_BADGE_CLASS, STATUS_LABEL } from '@/lib/tender-format';

// Color-coded tender status badge. Reads its palette from STATUS_BADGE_CLASS so
// the same colors are used everywhere a status appears (table, board, detail).
export function StatusBadge({
  status,
  className,
}: {
  status: TenderStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', STATUS_BADGE_CLASS[status], className)}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
