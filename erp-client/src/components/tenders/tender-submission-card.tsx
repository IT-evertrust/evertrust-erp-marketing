'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Gavel, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import type {
  ApprovalRequestDto,
  SubmissionReadinessDto,
} from '@evertrust/shared';
import {
  useDecideApproval,
  useRequestApproval,
  useTenderApprovals,
} from '@/hooks/use-approvals';
import { useSubmission, useSubmitTender } from '@/hooks/use-submission';
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
import { formatDateTime } from '@/lib/tender-format';

// Phase 7 (R34–R37): the submission gate + evidence. The submission act stays human
// (the portal); the team records the proof here and the API enforces the full gate
// (Phase 6 customer approval + conditional QC) before advancing to SUBMITTED — so a
// SUBMITTED tender always has a logged receipt. Readiness is computed server-side
// (the SAME predicates submit() enforces), so this card cannot drift from the gate.
export function TenderSubmissionCard({ tenderId }: { tenderId: string }) {
  const submission = useSubmission(tenderId);
  const r = submission.data;
  const submitted = !!r && (r.status === 'SUBMITTED' || r.receipts.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Submission</CardTitle>
        <CardDescription>
          Submit on the portal (human), then record the proof here. The gate —
          customer approval + conditional QC — is enforced before submission.
        </CardDescription>
        {r && r.canSubmit && !submitted ? (
          <Can permission="tenders:transition">
            <CardAction>
              <SubmitDialog tenderId={tenderId} documents={r.documents} />
            </CardAction>
          </Can>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {submission.isLoading || !r ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {submitted ? (
              <Alert className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 />
                <AlertTitle>Submitted</AlertTitle>
                <AlertDescription className="text-emerald-700/90 dark:text-emerald-400/90">
                  Submission proof is on record below.
                </AlertDescription>
              </Alert>
            ) : r.canSubmit ? (
              <Alert className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck />
                <AlertTitle>Ready to submit</AlertTitle>
                <AlertDescription className="text-emerald-700/90 dark:text-emerald-400/90">
                  All gates cleared. Record the portal proof to complete submission.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertTitle>Not ready to submit</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc pl-5">
                    {r.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {r.qcRequired || r.qcRequestExists ? (
              <QcSection tenderId={tenderId} readiness={r} />
            ) : null}

            {r.receipts.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Submission receipts
                </p>
                <ul className="divide-y divide-border rounded-lg border">
                  {r.receipts.map((rc) => (
                    <li key={rc.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                      <div className="min-w-0">
                        <div className="truncate" title={rc.proofUrl}>
                          {rc.proofUrl}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {(rc.fileList?.length ?? 0)} file
                          {(rc.fileList?.length ?? 0) === 1 ? '' : 's'}
                        </div>
                      </div>
                      <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(rc.submittedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// QC subsection — shown when QC is required (high-value / high-risk / opened) or a QC
// review already exists. Reuses the approvals mechanism with type 'QC'.
function QcSection({
  tenderId,
  readiness,
}: {
  tenderId: string;
  readiness: SubmissionReadinessDto;
}) {
  const approvals = useTenderApprovals(tenderId);
  const qcRows = (approvals.data ?? []).filter((a) => a.type === 'QC');
  const pendingQc = qcRows.find((a) => a.status === 'PENDING');

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Quality check (QC)</span>
            {readiness.hasApprovedQc ? (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              >
                Approved
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                Required
              </Badge>
            )}
          </div>
          {!readiness.hasApprovedQc && readiness.qcReasons.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {readiness.qcReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {!readiness.hasApprovedQc ? (
          pendingQc ? (
            <Can permission="approvals:decide">
              <QcDecideDialog tenderId={tenderId} approval={pendingQc} />
            </Can>
          ) : !readiness.qcRequestExists ? (
            <Can permission="tenders:write">
              <QcRequestDialog tenderId={tenderId} />
            </Can>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

// Open a PENDING QC review (approval_type 'QC').
function QcRequestDialog({ tenderId }: { tenderId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const request = useRequestApproval(tenderId);

  function submit() {
    request.mutate(
      { type: 'QC', evidenceUrl: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('QC review opened.');
          setOpen(false);
          setNote('');
        },
        onError: (e) => toast.error(e.message ?? 'Could not open the QC review.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send />
          Request QC
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request QC review</DialogTitle>
          <DialogDescription>
            Open a quality-check review for this tender. A senior reviewer records
            the decision; submission stays blocked until QC is approved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="qc-note">Note (optional)</Label>
          <Textarea
            id="qc-note"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should the reviewer focus on?"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={request.isPending}>
            {request.isPending ? 'Opening…' : 'Open QC review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Record the QC decision (APPROVED | REJECTED) + evidence.
function QcDecideDialog({
  tenderId,
  approval,
}: {
  tenderId: string;
  approval: ApprovalRequestDto;
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
      { approvalId: approval.id, input: { decision, evidenceUrl: evidence.trim() || undefined } },
      {
        onSuccess: (a) => {
          toast.success(
            a.status === 'APPROVED'
              ? 'QC approved — submission unblocked (if other gates pass).'
              : 'QC recorded as rejected.',
          );
          setOpen(false);
        },
        onError: (e) => toast.error(e.message ?? 'Could not record the QC decision.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gavel />
          Record QC
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record QC decision</DialogTitle>
          <DialogDescription>
            Approve or reject the quality check. Attach a note or link as evidence.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="qc-decision">Decision</Label>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as 'APPROVED' | 'REJECTED')}
            >
              <SelectTrigger id="qc-decision" className="w-full">
                <SelectValue placeholder="Approve or reject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qc-evidence">Evidence (optional)</Label>
            <Textarea
              id="qc-evidence"
              value={evidence}
              maxLength={2000}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="QC notes, checklist link, reviewer name…"
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

// Record the portal submission proof. The API re-checks the full gate, logs the
// receipt (proof + file-list snapshot) and advances the tender to SUBMITTED.
function SubmitDialog({
  tenderId,
  documents,
}: {
  tenderId: string;
  documents: string[];
}) {
  const [open, setOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState('');
  const submit = useSubmitTender(tenderId);

  function go() {
    const trimmed = proofUrl.trim();
    if (!trimmed) {
      toast.error('Enter the submission proof (a portal receipt link or note).');
      return;
    }
    submit.mutate(
      { proofUrl: trimmed },
      {
        onSuccess: () => {
          toast.success('Submission recorded — tender moved to Submitted.');
          setOpen(false);
          setProofUrl('');
        },
        onError: (e) => toast.error(e.message ?? 'Could not record the submission.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Send />
          Record submission
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record submission proof</DialogTitle>
          <DialogDescription>
            Paste the portal confirmation (receipt id, link, or a note). This logs
            the immutable evidence and moves the tender to Submitted.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="submit-proof">Submission proof</Label>
            <Textarea
              id="submit-proof"
              value={proofUrl}
              maxLength={2000}
              onChange={(e) => setProofUrl(e.target.value)}
              placeholder="e.g. DTVP receipt #A1B2C3, or 'submitted via Service-Bund 2026-05-31 09:12'"
            />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {documents.length > 0 ? (
              <>
                Recording {documents.length} file
                {documents.length === 1 ? '' : 's'}:{' '}
                <span className="text-foreground">{documents.join(', ')}</span>
              </>
            ) : (
              'No documents attached — the receipt will record an empty file list.'
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={go} disabled={submit.isPending}>
            {submit.isPending ? 'Recording…' : 'Record submission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
