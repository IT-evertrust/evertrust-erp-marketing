'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
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
import { REGIME_LABEL } from '@/lib/tender-format';
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
        toast.success('Tender updated.');
        setOpen(false);
      },
      onError: (error) => toast.error(error.message ?? 'Could not update tender.'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit tender</DialogTitle>
          <DialogDescription>
            Update tender details. Status changes happen via transitions, not here.
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
                  <FormLabel>Title</FormLabel>
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
                  <FormLabel>Vergabe-ID</FormLabel>
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
                  <FormLabel>Source</FormLabel>
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
                  <FormLabel>Buyer</FormLabel>
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
                  <FormLabel>Estimated value</FormLabel>
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
                  <FormLabel>Currency</FormLabel>
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
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
