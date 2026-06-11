'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
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
import { REGIME_LABEL } from '@/lib/tender-format';
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
        toast.success(`Tender “${tender.title}” created.`);
        router.push(`/tenders/${tender.id}`);
      },
      onError: (error) => toast.error(error.message ?? 'Could not create tender.'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New tender</CardTitle>
        <CardDescription>
          Register a tender. It starts in{' '}
          <code className="font-mono">NOT_STARTED</code>; move it through the
          lifecycle from its detail page.
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
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Tender title" {...field} />
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
                  <FormLabel>Vergabe-ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Portal reference" {...field} />
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
                  <FormLabel>Source</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. TED, eVergabe" {...field} />
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
                  <FormLabel>Buyer</FormLabel>
                  <FormControl>
                    <Input placeholder="Contracting authority" {...field} />
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
                  <FormLabel>Customer</FormLabel>
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) => field.onChange(v === NONE ? undefined : v)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="No customer" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>No customer</SelectItem>
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
                  <FormLabel>Regime</FormLabel>
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(v) =>
                      field.onChange(v === NONE ? undefined : TenderRegime.parse(v))
                    }
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Not set" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {TenderRegime.options.map((r) => (
                        <SelectItem key={r} value={r}>
                          {REGIME_LABEL[r]}
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
                  <FormLabel>Niche</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. HVAC, road works" {...field} />
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
                  <FormLabel>Estimated value</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0.00" {...field} />
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
                  <FormLabel>Currency</FormLabel>
                  <FormControl>
                    <Input
                      maxLength={3}
                      placeholder="EUR"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormDescription>3-letter ISO code.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="questionsDeadlineAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Questions deadline</FormLabel>
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
                  <FormLabel>Submission deadline</FormLabel>
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
                  <FormLabel>Location</FormLabel>
                  <FormControl>
                    <Input placeholder="Place of performance" {...field} />
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
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create tender'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
