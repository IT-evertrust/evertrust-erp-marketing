'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';
import type { DocumentDto } from '@evertrust/shared';
import { useTenderDocuments, useUploadTenderDocument } from '@/hooks/use-tenders';
import { api } from '@/lib/api';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatDateTime } from '@/lib/tender-format';

// Phase 4 (R22): the tender's TYPE 1 documents. Lists each file (name, kind,
// size, uploaded) with a Download link, plus an Upload action gated by
// tenders:write. Downloads go straight to the API URL (cookie auth rides along).
export function TenderDocumentsCard({ tenderId }: { tenderId: string }) {
  const t = useTranslations('tenders');
  const documents = useTenderDocuments(tenderId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('documents.title')}</CardTitle>
        <CardDescription>
          {t('documents.description')}
        </CardDescription>
        <Can permission="tenders:write">
          <CardAction>
            <UploadDialog tenderId={tenderId} />
          </CardAction>
        </Can>
      </CardHeader>
      <CardContent>
        {documents.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : documents.data && documents.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {documents.data.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('documents.empty')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentRow({ doc }: { doc: DocumentDto }) {
  const t = useTranslations('tenders');
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={doc.originalName}>
          {doc.originalName}
        </p>
        <p className="text-xs text-muted-foreground">
          {doc.kind ? `${doc.kind} · ` : ''}
          {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        {/* Plain anchor to the API download URL; the httpOnly cookie authorizes it. */}
        <a href={api.documents.downloadUrl(doc.id)}>
          <Download />
          {t('documents.download')}
        </a>
      </Button>
    </li>
  );
}

// Upload dialog: choose a file + optional kind, then POST multipart. type is
// fixed to TYPE1 for this card (the canonical Phase 4 upload).
function UploadDialog({ tenderId }: { tenderId: string }) {
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadTenderDocument(tenderId);

  function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error(t('documents.chooseFileError'));
      return;
    }
    upload.mutate(
      { file, input: { type: 'TYPE1', kind: kind.trim() || undefined } },
      {
        onSuccess: (doc) => {
          toast.success(t('documents.uploadedToast', { name: doc.originalName }));
          setOpen(false);
          setKind('');
          if (fileRef.current) fileRef.current.value = '';
        },
        onError: (error) => toast.error(error.message ?? t('documents.uploadError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload />
          {t('documents.upload')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('documents.uploadTitle')}</DialogTitle>
          <DialogDescription>
            {t('documents.uploadDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="file">{t('documents.fileLabel')}</Label>
            <Input
              id="file"
              type="file"
              ref={fileRef}
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.xml"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kind">{t('documents.kindLabel')}</Label>
            <Input
              id="kind"
              value={kind}
              maxLength={200}
              onChange={(e) => setKind(e.target.value)}
              placeholder={t('documents.kindPlaceholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={upload.isPending}>
            {upload.isPending ? t('documents.uploading') : t('documents.upload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
