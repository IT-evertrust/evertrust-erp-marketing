'use client';

import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
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
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(supplier);
  const create = useCreateSupplier();
  const update = useUpdateSupplier(supplier?.id ?? '');
  const pending = create.isPending || update.isPending;

  const form = useForm<SupplierFormValues>({ values: toForm(supplier) });

  function onSubmit(values: SupplierFormValues) {
    const payload = toPayload(values);
    const onSuccess = () => {
      toast.success(isEdit ? 'Supplier updated.' : 'Supplier created.');
      setOpen(false);
    };
    const onError = (error: Error) =>
      toast.error(error.message ?? 'Could not save supplier.');

    if (supplier) update.mutate(payload, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit supplier' : 'New supplier'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this supplier in the registry.'
              : 'Add a supplier to the registry.'}
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
              rules={{ required: 'Name is required.' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Supplier name" {...field} />
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
                  <FormLabel>Niches</FormLabel>
                  <FormControl>
                    <Input placeholder="HVAC, road works" {...field} />
                  </FormControl>
                  <FormDescription>Comma-separated.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capabilities"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capabilities</FormLabel>
                  <FormControl>
                    <Input placeholder="installation, maintenance" {...field} />
                  </FormControl>
                  <FormDescription>Comma-separated.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fitScore"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fit score</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0.00–1.00" {...field} />
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
                  <FormLabel>Contact</FormLabel>
                  <FormControl>
                    <Input placeholder="name@supplier.example" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create supplier'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
