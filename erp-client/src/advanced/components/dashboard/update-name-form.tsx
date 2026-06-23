'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('dashboard');
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
      toast.info(t('profile.unchanged'));
      return;
    }
    update.mutate(values, {
      onSuccess: (updated) =>
        toast.success(t('profile.updated', { name: updated.name })),
      onError: (error) =>
        toast.error(error.message ?? t('profile.updateError')),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.title')}</CardTitle>
        <CardDescription>{t('profile.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profile.nameLabel')}</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t('profile.saving') : t('profile.save')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
