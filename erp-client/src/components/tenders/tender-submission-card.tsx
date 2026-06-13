'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('tenders');
  const submission = useSubmission(tenderId);
  const r = submission.data;
  const submitted = !!r && (r.status === 'SUBMITTED' || r.receipts.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('submission.title')}</CardTitle>
        <CardDescription>
          {t('submission.description')}
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
                <AlertTitle>{t('submission.submittedTitle')}</AlertTitle>
                <AlertDescription className="text-emerald-700/90 dark:text-emerald-400/90">
                  {t('submission.submittedBody')}
                </AlertDescription>
              </Alert>
            ) : r.canSubmit ? (
              <Alert className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck />
                <AlertTitle>{t('submission.readyTitle')}</AlertTitle>
                <AlertDescription className="text-emerald-700/90 dark:text-emerald-400/90">
                  {t('submission.readyBody')}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertTitle>{t('submission.notReadyTitle')}</AlertTitle>
                <AlertDescription>
                  {/* Blocker reasons are produced server-side and rendered verbatim. */}
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
                  {t('submission.receiptsTitle')}
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
                          {t('submission.receiptFiles', { count: rc.fileList?.length ?? 0 })}
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
  const t = useTranslations('tenders');
  const approvals = useTenderApprovals(tenderId);
  const qcRows = (approvals.data ?? []).filter((a) => a.type === 'QC');
  const pendingQc = qcRows.find((a) => a.status === 'PENDING');

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('submission.qcTitle')}</span>
            {readiness.hasApprovedQc ? (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              >
                {t('submission.qcApproved')}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                {t('submission.qcRequired')}
              </Badge>
            )}
          </div>
          {/* QC reasons are produced server-side and rendered verbatim. */}
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
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const request = useRequestApproval(tenderId);

  function submit() {
    request.mutate(
      { type: 'QC', evidenceUrl: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(t('submission.qcOpened'));
          setOpen(false);
          setNote('');
        },
        onError: (e) => toast.error(e.message ?? t('submission.qcOpenError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send />
          {t('submission.requestQc')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('submission.qcRequestTitle')}</DialogTitle>
          <DialogDescription>
            {t('submission.qcRequestDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="qc-note">{t('submission.qcNoteLabel')}</Label>
          <Textarea
            id="qc-note"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('submission.qcNotePlaceholder')}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={request.isPending}>
            {request.isPending ? t('submission.opening') : t('submission.qcOpenReview')}
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
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | undefined>(
    undefined,
  );
  const [evidence, setEvidence] = useState(approval.evidenceUrl ?? '');
  const decide = useDecideApproval(tenderId);

  function submit() {
    if (!decision) {
      toast.error(t('submission.chooseError'));
      return;
    }
    decide.mutate(
      { approvalId: approval.id, input: { decision, evidenceUrl: evidence.trim() || undefined } },
      {
        onSuccess: (a) => {
          toast.success(
            a.status === 'APPROVED'
              ? t('submission.qcApprovedToast')
              : t('submission.qcRejectedToast'),
          );
          setOpen(false);
        },
        onError: (e) => toast.error(e.message ?? t('submission.qcDecideError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gavel />
          {t('submission.recordQc')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('submission.qcDecideTitle')}</DialogTitle>
          <DialogDescription>
            {t('submission.qcDecideDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="qc-decision">{t('submission.decisionLabel')}</Label>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as 'APPROVED' | 'REJECTED')}
            >
              <SelectTrigger id="qc-decision" className="w-full">
                <SelectValue placeholder={t('submission.decisionPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">{t('submission.approved')}</SelectItem>
                <SelectItem value="REJECTED">{t('submission.rejected')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qc-evidence">{t('submission.qcEvidenceLabel')}</Label>
            <Textarea
              id="qc-evidence"
              value={evidence}
              maxLength={2000}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder={t('submission.qcEvidencePlaceholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={decide.isPending}>
            {decide.isPending ? t('submission.saving') : t('submission.saveDecision')}
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
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState('');
  const submit = useSubmitTender(tenderId);

  function go() {
    const trimmed = proofUrl.trim();
    if (!trimmed) {
      toast.error(t('submission.proofError'));
      return;
    }
    submit.mutate(
      { proofUrl: trimmed },
      {
        onSuccess: () => {
          toast.success(t('submission.recordedToast'));
          setOpen(false);
          setProofUrl('');
        },
        onError: (e) => toast.error(e.message ?? t('submission.recordError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Send />
          {t('submission.recordSubmission')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('submission.recordSubmissionTitle')}</DialogTitle>
          <DialogDescription>
            {t('submission.recordSubmissionDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="submit-proof">{t('submission.proofLabel')}</Label>
            <Textarea
              id="submit-proof"
              value={proofUrl}
              maxLength={2000}
              onChange={(e) => setProofUrl(e.target.value)}
              placeholder={t('submission.proofPlaceholder')}
            />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {documents.length > 0 ? (
              t('submission.recordingFiles', {
                count: documents.length,
                files: documents.join(', '),
              })
            ) : (
              t('submission.noDocuments')
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={go} disabled={submit.isPending}>
            {submit.isPending ? t('submission.recording') : t('submission.recordSubmission')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
