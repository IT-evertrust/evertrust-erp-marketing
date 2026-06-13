'use client';

import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { CreateCustomerDto, CustomerDto } from '@evertrust/shared';
import { useCreateCustomer, useUpdateCustomer } from '@/hooks/use-customers';
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

type CustomerFormValues = {
  name: string;
  contact: string;
  niches: string;
};

function toForm(customer?: CustomerDto): CustomerFormValues {
  return {
    name: customer?.name ?? '',
    contact: customer?.contact ?? '',
    niches: joinList(customer?.niches),
  };
}

function toPayload(values: CustomerFormValues): CreateCustomerDto {
  return {
    name: values.name.trim(),
    contact: values.contact.trim() || undefined,
    niches: parseList(values.niches),
  };
}

// Create/edit dialog for a customer. With `customer` it edits (PATCH); without,
// it creates (POST). The trigger comes from the caller (page "New" button / row Edit).
export function CustomerDialog({
  customer,
  trigger,
}: {
  customer?: CustomerDto;
  trigger: ReactNode;
}) {
  const t = useTranslations('customers');
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(customer);
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? '');
  const pending = create.isPending || update.isPending;

  const form = useForm<CustomerFormValues>({ values: toForm(customer) });

  function onSubmit(values: CustomerFormValues) {
    const payload = toPayload(values);
    const onSuccess = () => {
      toast.success(isEdit ? t('toast.updated') : t('toast.created'));
      setOpen(false);
    };
    const onError = (error: Error) =>
      toast.error(error.message ?? t('toast.saveError'));

    if (customer) update.mutate(payload, { onSuccess, onError });
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
