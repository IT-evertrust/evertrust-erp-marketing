'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CreateTenderDto, TenderRegime } from '@evertrust/shared';
import { useCreateTender } from '@/hooks/use-tenders';
import { useCustomers } from '@/hooks/use-customers';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  NONE,
  cleanTenderPayload,
  isoToLocalInput,
  localInputToIso,
  type TenderFormValues,
} from './tender-form-utils';

// Create form for a new tender. Validated against CreateTenderDto via
// zodResolver. vergabeId/source/title are required; everything else is
// optional. On success we route to the new tender's detail page.
export function TenderCreateForm() {
  const t = useTranslations('tenders');
  const router = useRouter();
  const create = useCreateTender();
  const customers = useCustomers();

  const form = useForm<TenderFormValues>({
    resolver: zodResolver(CreateTenderDto),
    defaultValues: {
      vergabeId: '',
      source: '',
      title: '',
      buyer: '',
      customerId: undefined,
      regime: undefined,
      niche: '',
      estimatedValue: '',
      currency: 'EUR',
      isAboveThreshold: false,
      questionsDeadlineAt: undefined,
      submissionDeadlineAt: undefined,
      location: '',
    },
  });

  function onSubmit(values: TenderFormValues) {
    const payload = cleanTenderPayload(values);
    create.mutate(payload, {
      onSuccess: (tender) => {
        toast.success(t('new.created', { title: tender.title }));
        router.push(`/tenders/${tender.id}`);
      },
      onError: (error) => toast.error(error.message ?? t('new.createError')),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('new.title')}</CardTitle>
        <CardDescription>
          {t.rich('new.description', {
            code: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                    <Input placeholder={t('form.titlePlaceholder')} {...field} />
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
                    <Input placeholder={t('form.vergabeIdPlaceholder')} {...field} />
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
                    <Input placeholder={t('form.sourcePlaceholder')} {...field} />
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
                    <Input placeholder={t('form.buyerPlaceholder')} {...field} />
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
                    <Input placeholder={t('form.nichePlaceholder')} {...field} />
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
                    <Input inputMode="decimal" placeholder={t('form.estimatedValuePlaceholder')} {...field} />
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
                      placeholder={t('form.currencyPlaceholder')}
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormDescription>{t('form.currencyHint')}</FormDescription>
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
                    <Input placeholder={t('form.locationPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push('/tenders')}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? t('new.submitting') : t('new.submit')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
