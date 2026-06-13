'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import {
  TenderRegime,
  UpdateTenderDto,
  type TenderDto,
} from '@evertrust/shared';
import { useUpdateTender } from '@/hooks/use-tenders';
import { useCustomers } from '@/hooks/use-customers';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  NONE,
  cleanTenderUpdate,
  isoToLocalInput,
  localInputToIso,
  type TenderFormValues,
} from './tender-form-utils';

// Map a tender row to the form's value shape (nulls -> '' / undefined).
function toFormValues(tender: TenderDto): TenderFormValues {
  return {
    vergabeId: tender.vergabeId,
    source: tender.source,
    title: tender.title,
    buyer: tender.buyer ?? '',
    customerId: tender.customerId ?? undefined,
    regime: tender.regime ?? undefined,
    niche: tender.niche ?? '',
    estimatedValue: tender.estimatedValue ?? '',
    currency: tender.currency,
    isAboveThreshold: tender.isAboveThreshold,
    questionsDeadlineAt: tender.questionsDeadlineAt ?? undefined,
    submissionDeadlineAt: tender.submissionDeadlineAt ?? undefined,
    location: tender.location ?? '',
  };
}

// Edit dialog for a tender's writable fields (PATCH /tenders/:id). Status is NOT
// editable here — it only changes via the transition control. Mounted behind a
// <Can tenders:write> on the detail page.
export function TenderEditDialog({ tender }: { tender: TenderDto }) {
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const update = useUpdateTender(tender.id);
  const customers = useCustomers();

  const form = useForm<TenderFormValues>({
    resolver: zodResolver(UpdateTenderDto),
    values: toFormValues(tender),
  });

  function onSubmit(values: TenderFormValues) {
    update.mutate(cleanTenderUpdate(values), {
      onSuccess: () => {
        toast.success(t('edit.saved'));
        setOpen(false);
      },
      onError: (error) => toast.error(error.message ?? t('edit.saveError')),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil />
          {t('edit.trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
          <DialogDescription>
            {t('edit.description')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t('form.title')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vergabeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.vergabeId')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.source')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="buyer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.buyer')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.customer')}</FormLabel>
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) => field.onChange(v === NONE ? undefined : v)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('form.noCustomer')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('form.noCustomer')}</SelectItem>
                      {customers.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="regime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.regime')}</FormLabel>
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) =>
                      field.onChange(v === NONE ? undefined : TenderRegime.parse(v))
                    }
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('regime.notSet')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('regime.notSet')}</SelectItem>
                      {TenderRegime.options.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(`regime.${r}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="niche"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.niche')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="estimatedValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.estimatedValue')}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.currency')}</FormLabel>
                  <FormControl>
                    <Input
                      maxLength={3}
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="questionsDeadlineAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.questionsDeadline')}</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      value={isoToLocalInput(field.value)}
                      onChange={(e) => field.onChange(localInputToIso(e.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="submissionDeadlineAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.submissionDeadline')}</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      value={isoToLocalInput(field.value)}
                      onChange={(e) => field.onChange(localInputToIso(e.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t('form.location')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t('edit.submitting') : t('edit.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
