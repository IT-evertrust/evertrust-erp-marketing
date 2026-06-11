'use client';

import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
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
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(customer);
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? '');
  const pending = create.isPending || update.isPending;

  const form = useForm<CustomerFormValues>({ values: toForm(customer) });

  function onSubmit(values: CustomerFormValues) {
    const payload = toPayload(values);
    const onSuccess = () => {
      toast.success(isEdit ? 'Customer updated.' : 'Customer created.');
      setOpen(false);
    };
    const onError = (error: Error) =>
      toast.error(error.message ?? 'Could not save customer.');

    if (customer) update.mutate(payload, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit customer' : 'New customer'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this customer in the registry.'
              : 'Add a customer to the registry.'}
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
                    <Input placeholder="Customer name" {...field} />
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
                    <Input placeholder="name@customer.example" {...field} />
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
                    <Input placeholder="public works, utilities" {...field} />
                  </FormControl>
                  <FormDescription>Comma-separated.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create customer'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
