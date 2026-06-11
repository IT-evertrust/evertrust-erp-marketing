'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
  const approvals = useTenderApprovals(tenderId);
  const rows = approvals.data ?? [];
  const hasCustomerApproval = rows.some(
    (a) => a.type === 'CUSTOMER' && a.status === 'APPROVED',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customer Approval</CardTitle>
        <CardDescription>
          Submission stays blocked until the customer&apos;s approval is recorded —
          any channel counts (email, WhatsApp, call).
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
                <AlertTitle>Customer approval recorded</AlertTitle>
                <AlertDescription className="text-emerald-700/90 dark:text-emerald-400/90">
                  Submission is unblocked for this tender.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertTitle>No customer approval recorded</AlertTitle>
                <AlertDescription>
                  This tender cannot be submitted until an approval is recorded.
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
                No approval requests yet.
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
            Evidence: {approval.evidenceUrl}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {decided
            ? `Decided ${formatDateTime(approval.decidedAt)}`
            : `Requested ${formatDateTime(approval.requestedAt)}`}
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

const STATUS_BADGE: Record<
  ApprovalStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: 'Pending',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  APPROVED: {
    label: 'Approved',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  REJECTED: {
    label: 'Rejected',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
};

function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const s = STATUS_BADGE[status];
  return (
    <Badge variant="outline" className={cn('font-medium', s.className)}>
      {s.label}
    </Badge>
  );
}

// Open a PENDING customer-approval request, optionally attaching the evidence now.
function RequestDialog({ tenderId }: { tenderId: string }) {
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
          toast.success('Approval request opened.');
          setOpen(false);
          setEvidence('');
        },
        onError: (error) =>
          toast.error(error.message ?? 'Could not open the request.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send />
          Request approval
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request customer approval</DialogTitle>
          <DialogDescription>
            Open a pending customer-approval request. The decision is recorded
            separately once the customer responds.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="request-evidence">Evidence (optional)</Label>
          <Textarea
            id="request-evidence"
            value={evidence}
            maxLength={2000}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Link or note — e.g. email thread URL, or 'sent pricing pack via WhatsApp 2026-05-30'"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={request.isPending}>
            {request.isPending ? 'Opening…' : 'Open request'}
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
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | undefined>(
    undefined,
  );
  const [evidence, setEvidence] = useState(approval.evidenceUrl ?? '');
  const decide = useDecideApproval(tenderId);

  function submit() {
    if (!decision) {
      toast.error('Choose approve or reject.');
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
              ? 'Customer approval recorded — submission unblocked.'
              : 'Recorded as rejected.',
          );
          setOpen(false);
        },
        onError: (error) =>
          toast.error(error.message ?? 'Could not record the decision.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gavel />
          Record decision
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record customer decision</DialogTitle>
          <DialogDescription>
            Attach the proof of the customer&apos;s decision. Any channel counts —
            paste a link or describe the call.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="decision">Decision</Label>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as 'APPROVED' | 'REJECTED')}
            >
              <SelectTrigger id="decision" className="w-full">
                <SelectValue placeholder="Approve or reject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="decide-evidence">Evidence</Label>
            <Textarea
              id="decide-evidence"
              value={evidence}
              maxLength={2000}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="Link or note — e.g. 'phone 2026-05-30, confirmed by Frau Müller'"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={decide.isPending}>
            {decide.isPending ? 'Saving…' : 'Save decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
