'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ShieldCheck, ShieldAlert, Gavel, Send } from 'lucide-react';
import type { ApprovalRequestDto, ApprovalStatus } from '@evertrust/shared';
import {
  useTenderApprovals,
  useRequestApproval,
  useDecideApproval,
} from '@/hooks/use-approvals';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';

// Phase 6 (R30): the customer-approval gate. "No written approval → no submission"
// is enforced in the API; this card makes the gate state visible and lets the team
// record it. Approval is CHANNEL-AGNOSTIC — the evidence field accepts a link OR a
// plain note (a WhatsApp screenshot link, an email thread, "phone call confirmed
// by …"). Opening a request is gated by tenders:write; the DECISION (what unblocks
// submission) by approvals:decide.
export function TenderApprovalCard({ tenderId }: { tenderId: string }) {
  const t = useTranslations('tenders');
  const approvals = useTenderApprovals(tenderId);
  const rows = approvals.data ?? [];
  const hasCustomerApproval = rows.some(
    (a) => a.type === 'CUSTOMER' && a.status === 'APPROVED',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('approval.title')}</CardTitle>
        <CardDescription>
          {t('approval.description')}
        </CardDescription>
        <Can permission="tenders:write">
          <CardAction>
            <RequestDialog tenderId={tenderId} />
          </CardAction>
        </Can>
      </CardHeader>
      <CardContent className="grid gap-4">
        {approvals.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            {hasCustomerApproval ? (
              <Alert className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck />
                <AlertTitle>{t('approval.recordedTitle')}</AlertTitle>
                <AlertDescription className="text-emerald-700/90 dark:text-emerald-400/90">
                  {t('approval.recordedBody')}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertTitle>{t('approval.missingTitle')}</AlertTitle>
                <AlertDescription>
                  {t('approval.missingBody')}
                </AlertDescription>
              </Alert>
            )}

            {rows.length > 0 ? (
              <ul className="divide-y divide-border">
                {rows.map((a) => (
                  <ApprovalRow key={a.id} approval={a} tenderId={tenderId} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('approval.empty')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ApprovalRow({
  approval,
  tenderId,
}: {
  approval: ApprovalRequestDto;
  tenderId: string;
}) {
  const t = useTranslations('tenders');
  const decided = approval.status !== 'PENDING';
  return (
    <li className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {approval.type}
          </Badge>
          <ApprovalStatusBadge status={approval.status} />
        </div>
        {approval.evidenceUrl ? (
          <p
            className="mt-1 truncate text-sm text-muted-foreground"
            title={approval.evidenceUrl}
          >
            {t('approval.evidenceLine', { evidence: approval.evidenceUrl })}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {decided
            ? t('approval.decided', { date: formatDateTime(approval.decidedAt) })
            : t('approval.requested', { date: formatDateTime(approval.requestedAt) })}
        </p>
      </div>
      {!decided ? (
        <Can permission="approvals:decide">
          <DecideDialog approval={approval} tenderId={tenderId} />
        </Can>
      ) : null}
    </li>
  );
}

// Badge palette per approval status. The label is translated at the call site
// (approval.status.<status>) rather than stored alongside the className.
const STATUS_BADGE_CLASS: Record<ApprovalStatus, string> = {
  PENDING: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  APPROVED:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'border-destructive/30 bg-destructive/10 text-destructive',
};

function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const t = useTranslations('tenders');
  return (
    <Badge variant="outline" className={cn('font-medium', STATUS_BADGE_CLASS[status])}>
      {t(`approval.status.${status}`)}
    </Badge>
  );
}

// Open a PENDING customer-approval request, optionally attaching the evidence now.
function RequestDialog({ tenderId }: { tenderId: string }) {
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState('');
  const request = useRequestApproval(tenderId);

  function submit() {
    request.mutate(
      {
        type: 'CUSTOMER',
        evidenceUrl: evidence.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('approval.requestOpened'));
          setOpen(false);
          setEvidence('');
        },
        onError: (error) =>
          toast.error(error.message ?? t('approval.requestError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send />
          {t('approval.request')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('approval.requestTitle')}</DialogTitle>
          <DialogDescription>
            {t('approval.requestDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="request-evidence">{t('approval.requestEvidenceLabel')}</Label>
          <Textarea
            id="request-evidence"
            value={evidence}
            maxLength={2000}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder={t('approval.requestEvidencePlaceholder')}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={request.isPending}>
            {request.isPending ? t('approval.opening') : t('approval.openRequest')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Record the customer's decision (APPROVED | REJECTED) + channel-agnostic evidence.
function DecideDialog({
  approval,
  tenderId,
}: {
  approval: ApprovalRequestDto;
  tenderId: string;
}) {
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | undefined>(
    undefined,
  );
  const [evidence, setEvidence] = useState(approval.evidenceUrl ?? '');
  const decide = useDecideApproval(tenderId);

  function submit() {
    if (!decision) {
      toast.error(t('approval.chooseError'));
      return;
    }
    decide.mutate(
      {
        approvalId: approval.id,
        input: { decision, evidenceUrl: evidence.trim() || undefined },
      },
      {
        onSuccess: (a) => {
          toast.success(
            a.status === 'APPROVED'
              ? t('approval.approvedToast')
              : t('approval.rejectedToast'),
          );
          setOpen(false);
        },
        onError: (error) =>
          toast.error(error.message ?? t('approval.decideError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gavel />
          {t('approval.recordDecision')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('approval.decideTitle')}</DialogTitle>
          <DialogDescription>
            {t('approval.decideDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="decision">{t('approval.decisionLabel')}</Label>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as 'APPROVED' | 'REJECTED')}
            >
              <SelectTrigger id="decision" className="w-full">
                <SelectValue placeholder={t('approval.decisionPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">{t('approval.approved')}</SelectItem>
                <SelectItem value="REJECTED">{t('approval.rejected')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="decide-evidence">{t('approval.decideEvidenceLabel')}</Label>
            <Textarea
              id="decide-evidence"
              value={evidence}
              maxLength={2000}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder={t('approval.decideEvidencePlaceholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={decide.isPending}>
            {decide.isPending ? t('approval.saving') : t('approval.saveDecision')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
