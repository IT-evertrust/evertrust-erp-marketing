'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { UpdateMyNameDto } from '@evertrust/shared';
import type { MeDto } from '@evertrust/shared';
import { useUpdateMyName } from '@/hooks/use-auth';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

// Demo audited mutation: PATCH /users/me. The cache update lives in useUpdateMyName,
// so on success the displayed name refreshes everywhere without a refetch.
export function UpdateNameForm({ user }: { user: MeDto }) {
  const update = useUpdateMyName();
  const form = useForm<UpdateMyNameDto>({
    resolver: zodResolver(UpdateMyNameDto),
    defaultValues: { name: user.name },
  });

  // Keep the field in sync if the user changes elsewhere (e.g. cache update).
  useEffect(() => {
    form.reset({ name: user.name });
  }, [user.name, form]);

  function onSubmit(values: UpdateMyNameDto) {
    if (values.name === user.name) {
      toast.info('Name is unchanged.');
      return;
    }
    update.mutate(values, {
      onSuccess: (updated) => toast.success(`Name updated to “${updated.name}”.`),
      onError: (error) => toast.error(error.message ?? 'Could not update your name.'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update your display name. This action is audited.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
