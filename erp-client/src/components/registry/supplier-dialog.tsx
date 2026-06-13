'use client';

import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { CreateSupplierDto, SupplierDto } from '@evertrust/shared';
import { useCreateSupplier, useUpdateSupplier } from '@/hooks/use-suppliers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { joinList, parseList } from './list-input';

type SupplierFormValues = {
  name: string;
  niches: string;
  capabilities: string;
  fitScore: string;
  contact: string;
};

function toForm(supplier?: SupplierDto): SupplierFormValues {
  return {
    name: supplier?.name ?? '',
    niches: joinList(supplier?.niches),
    capabilities: joinList(supplier?.capabilities),
    fitScore: supplier?.fitScore ?? '',
    contact: supplier?.contact ?? '',
  };
}

// Build the create/update payload. Empty optional strings are dropped; the
// comma-separated list fields are parsed to string[].
function toPayload(values: SupplierFormValues): CreateSupplierDto {
  return {
    name: values.name.trim(),
    niches: parseList(values.niches),
    capabilities: parseList(values.capabilities),
    fitScore: values.fitScore.trim() || undefined,
    contact: values.contact.trim() || undefined,
  };
}

// Create/edit dialog for a supplier. With `supplier` it edits (PATCH); without,
// it creates (POST). The trigger is provided by the caller so the same dialog
// serves the page header ("New supplier") and per-row "Edit".
export function SupplierDialog({
  supplier,
  trigger,
}: {
  supplier?: SupplierDto;
  trigger: ReactNode;
}) {
  const t = useTranslations('suppliers');
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(supplier);
  const create = useCreateSupplier();
  const update = useUpdateSupplier(supplier?.id ?? '');
  const pending = create.isPending || update.isPending;

  const form = useForm<SupplierFormValues>({ values: toForm(supplier) });

  function onSubmit(values: SupplierFormValues) {
    const payload = toPayload(values);
    const onSuccess = () => {
      toast.success(isEdit ? t('toast.updated') : t('toast.created'));
      setOpen(false);
    };
    const onError = (error: Error) =>
      toast.error(error.message ?? t('toast.saveError'));

    if (supplier) update.mutate(payload, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('dialog.titleEdit') : t('dialog.titleNew')}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('dialog.descriptionEdit')
              : t('dialog.descriptionNew')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              rules={{ required: t('dialog.nameRequired') }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('dialog.fields.name.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('dialog.fields.name.placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="niches"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('dialog.fields.niches.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('dialog.fields.niches.placeholder')} {...field} />
                  </FormControl>
                  <FormDescription>{t('dialog.commaSeparated')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capabilities"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('dialog.fields.capabilities.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('dialog.fields.capabilities.placeholder')} {...field} />
                  </FormControl>
                  <FormDescription>{t('dialog.commaSeparated')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fitScore"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('dialog.fields.fitScore.label')}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder={t('dialog.fields.fitScore.placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contact"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('dialog.fields.contact.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('dialog.fields.contact.placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('dialog.cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('dialog.saving') : isEdit ? t('dialog.saveChanges') : t('dialog.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
