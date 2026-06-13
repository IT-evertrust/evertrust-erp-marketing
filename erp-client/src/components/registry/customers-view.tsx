'use client';

import { Building2, Mail, Pencil, Plus, Tags, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomerDto } from '@evertrust/shared';
import { useCustomers } from '@/hooks/use-customers';
import { Can } from '@/components/auth/can';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/common/page-header';
import { StatTile } from '@/components/common/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { formatDateTime } from '@/lib/tender-format';
import { CustomerDialog } from './customer-dialog';

// Two leading initials from a customer name, for the tinted avatar.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// Customer registry, enriched: a PageHeader masthead (with the write-gated
// "New customer" action), a stat row computed from the fetched list (headcount,
// how many are reachable, distinct niche coverage), then the customer table —
// avatar rows, niche badges, join date, write-gated per-row Edit. Empty →
// EmptyState, loading → Skeleton. All create/edit behaviour is unchanged.
export function CustomersView() {
  const t = useTranslations('customers');
  const { data, isLoading, isError, error } = useCustomers();
  const customers = data ?? [];
  const ready = !isLoading && !isError;

  const withContact = customers.filter((c) => Boolean(c.contact)).length;
  const niches = new Set(customers.flatMap((c) => c.niches)).size;

  const newCustomerAction = (
    <Can permission="customers:write">
      <CustomerDialog
        trigger={
          <Button>
            <Plus />
            {t('actions.new')}
          </Button>
        }
      />
    </Can>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
        actions={newCustomerAction}
      />

      {/* Summary tiles — all counts come from the list already fetched above. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label={t('stats.customers.label')}
          value={ready ? customers.length : <Skeleton className="h-7 w-10" />}
          hint={t('stats.customers.hint')}
          accent="bg-sky-400"
          icon={<Users className="size-4" />}
        />
        <StatTile
          label={t('stats.withContact.label')}
          value={ready ? withContact : <Skeleton className="h-7 w-10" />}
          hint={
            ready
              ? t('stats.withContact.hint', { count: customers.length - withContact })
              : undefined
          }
          accent="bg-emerald-400"
          icon={<Mail className="size-4" />}
        />
        <StatTile
          label={t('stats.niches.label')}
          value={ready ? niches : <Skeleton className="h-7 w-10" />}
          hint={t('stats.niches.hint')}
          accent="bg-violet-400"
          icon={<Tags className="size-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('registry.title')}</CardTitle>
          <CardDescription>
            {t('registry.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
              {t('errorState.message', { error: error.message })}
            </div>
          ) : customers.length === 0 ? (
            <EmptyState
              icon={<Building2 />}
              title={t('emptyState.title')}
              description={t('emptyState.description')}
              action={newCustomerAction}
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('table.customer')}</TableHead>
                    <TableHead>{t('table.niches')}</TableHead>
                    <TableHead>{t('table.added')}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <CustomerRow key={customer.id} customer={customer} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// One registry row: tinted avatar + name over contact, niche badges, join date,
// and the write-gated Edit dialog trigger.
function CustomerRow({ customer }: { customer: CustomerDto }) {
  const t = useTranslations('customers');
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback className="bg-sky-500/10 text-xs font-medium text-sky-600 dark:text-sky-400">
              {initials(customer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium leading-tight">
              {customer.name}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {customer.contact ?? t('noContact')}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {customer.niches.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {customer.niches.map((n) => (
              <Badge key={n} variant="secondary" className="font-normal">
                {n}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatDateTime(customer.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <Can permission="customers:write">
          <CustomerDialog
            customer={customer}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={t('actions.edit')}>
                <Pencil />
              </Button>
            }
          />
        </Can>
      </TableCell>
    </TableRow>
  );
}
