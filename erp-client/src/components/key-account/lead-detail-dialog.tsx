'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  LeadStageLabel,
  type LeadDto,
  type LeadStage,
} from '@evertrust/shared';
import { useConvertLead, useUpdateLead } from '@/hooks/use-leads';
import { Can } from '@/components/auth/can';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ContractsCard } from '@/components/growth/contracts-card';
import { formatDateTime } from '@/lib/tender-format';

const STAGES: LeadStage[] = [
  'INTERESTED',
  'MEETING_SCHEDULED',
  'ONGOING',
  'CUSTOMER',
  'ARCHIVED',
];

// Review one hot lead: its fields + note, change its stage, and graduate it to an
// ERP customer. Controlled by the `lead` prop (open when non-null).
export function LeadDetailDialog({
  lead,
  onOpenChange,
}: {
  lead: LeadDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateLead();
  const convert = useConvertLead();
  const [stage, setStage] = useState<LeadStage>('INTERESTED');

  useEffect(() => {
    if (lead) setStage(lead.stage);
  }, [lead]);

  const onStageChange = (next: string) => {
    if (!lead) return;
    const value = next as LeadStage;
    setStage(value);
    update.mutate({ id: lead.id, patch: { stage: value } });
  };

  const isCustomer = !!lead?.customerId || lead?.stage === 'CUSTOMER';

  return (
    <Dialog open={!!lead} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        {lead ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {lead.companyName || lead.email}
                {lead.tier ? (
                  <Badge variant="outline" className="text-[10px]">
                    {lead.tier}
                  </Badge>
                ) : null}
              </DialogTitle>
              <DialogDescription>{lead.email}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Hot reason" value={lead.hotReason} />
              <Field label="Lead status" value={lead.leadStatus} />
              <Field label="Company type" value={lead.companyType} />
              <Field label="Country" value={lead.country} />
              <Field label="City" value={lead.city} />
              <Field label="Source campaign" value={lead.sourceCampaign} />
              <Field label="Meeting date" value={lead.meetingDate} />
              <Field
                label="Detected"
                value={lead.detectedAt ? formatDateTime(lead.detectedAt) : null}
              />
              <Field
                label="Website"
                value={lead.website}
              />
            </dl>

            {lead.note ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                {lead.note}
              </div>
            ) : null}

            <ContractsCard
              filters={{ leadId: lead.id }}
              emptyHint="No contracts generated for this lead yet."
            />

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Stage</span>
              <Can permission="campaigns:write" fallback={<Badge>{LeadStageLabel[stage]}</Badge>}>
                <Select value={stage} onValueChange={onStageChange}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {LeadStageLabel[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Can>
              {update.isPending ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            {convert.isError ? (
              <p className="text-sm text-destructive">{convert.error.message}</p>
            ) : null}

            <DialogFooter>
              <Can permission="customers:write">
                <Button
                  type="button"
                  onClick={() =>
                    convert.mutate(lead.id, {
                      onSuccess: () => onOpenChange(false),
                    })
                  }
                  disabled={isCustomer || convert.isPending}
                >
                  {convert.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : null}
                  {isCustomer ? 'Already a customer' : 'Convert to customer'}
                </Button>
              </Can>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate">{value || '—'}</dd>
    </div>
  );
}
