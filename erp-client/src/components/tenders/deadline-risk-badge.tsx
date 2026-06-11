import { Clock } from 'lucide-react';
import type { DeadlineRiskDto } from '@evertrust/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DEADLINE_LEVEL_CLASS,
  DEADLINE_LEVEL_LABEL,
  formatDaysRemaining,
} from '@/lib/tender-format';

// Phase 6 (R31): a colour-coded deadline-risk badge ("At risk · 2 days left").
// Renders nothing when there is no deadline / the tender is closed (level NONE),
// so callers can drop it in unconditionally. Reads its palette from
// DEADLINE_LEVEL_CLASS so the colour is consistent on the detail page and the
// dashboard worklist.
export function DeadlineRiskBadge({
  risk,
  className,
}: {
  risk: DeadlineRiskDto;
  className?: string;
}) {
  if (!risk.hasDeadline || risk.level === 'NONE') return null;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium', DEADLINE_LEVEL_CLASS[risk.level], className)}
    >
      <Clock className="size-3" />
      {DEADLINE_LEVEL_LABEL[risk.level]} · {formatDaysRemaining(risk.daysRemaining)}
    </Badge>
  );
}
