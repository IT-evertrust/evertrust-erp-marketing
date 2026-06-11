'use client';

import {
  Factory,
  Layers,
  Mail,
  MailX,
  Pencil,
  Plus,
  Target,
} from 'lucide-react';
import { useSuppliers } from '@/hooks/use-suppliers';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { cn } from '@/lib/utils';
import { SupplierDialog } from './supplier-dialog';

// Build the supplier initials used in the row avatar (e.g. "Acme Road Works" → "AR").
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// fitScore is a stored string ("0.00"–"1.00"); parse leniently for colour coding.
function fitOf(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

// Semantic colour for the fit score: strong = emerald, moderate = amber, weak =
// muted. Keeps the registry readable at a glance without rainbowing.
function fitTint(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value >= 0.75) return 'text-emerald-400';
  if (value >= 0.5) return 'text-amber-400';
  return 'text-muted-foreground';
}

// Supplier registry: a masthead (with the write-gated "New supplier" action), a
// row of live KPI tiles computed from the fetched list (sourcing readiness at a
// glance), then the editable registry table. Empty/error → EmptyState; loading →
// Skeleton.
export function SuppliersView() {
  const { data, isLoading, isError, error } = useSuppliers();
  const suppliers = data ?? [];
  const ready = !isLoading && !isError;

  // KPIs — all derived from the list the page already fetches.
  const total = suppliers.length;
  const withFit = suppliers.filter((s) => fitOf(s.fitScore) != null).length;
  const reachable = suppliers.filter((s) => Boolean(s.contact)).length;
  const niches = new Set(suppliers.flatMap((s) => s.niches)).size;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Suppliers"
        description="Your supplier registry for matching and sourcing."
        actions={
          <Can permission="suppliers:write">
            <SupplierDialog
              trigger={
                <Button>
                  <Plus />
                  New supplier
                </Button>
              }
            />
          </Can>
        }
      />

      {/* Live registry KPIs. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Suppliers"
          value={ready ? total : <Skeleton className="h-6 w-10" />}
          hint="In the registry"
          accent="bg-sky-400"
          icon={<Factory className="size-4" />}
        />
        <StatTile
          label="Niches covered"
          value={ready ? niches : <Skeleton className="h-6 w-10" />}
          hint="Distinct sourcing areas"
          accent="bg-violet-400"
          icon={<Layers className="size-4" />}
        />
        <StatTile
          label="Scored for fit"
          value={ready ? withFit : <Skeleton className="h-6 w-10" />}
          hint={
            ready && total > 0
              ? `${total - withFit} not yet scored`
              : 'Ready for matching'
          }
          accent="bg-emerald-400"
          icon={<Target className="size-4" />}
        />
        <StatTile
          label="Reachable"
          value={ready ? reachable : <Skeleton className="h-6 w-10" />}
          hint={
            ready && total > 0
              ? `${total - reachable} missing contact`
              : 'With a contact on file'
          }
          accent={ready && total > 0 && reachable < total ? 'bg-amber-400' : 'bg-emerald-400'}
          icon={<Mail className="size-4" />}
        />
      </div>

      {/* Registry table. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registry</CardTitle>
          <CardDescription>
            Suppliers available for tender matching and sourcing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : isError ? (
            <EmptyState
              icon={<MailX />}
              title="Could not load suppliers"
              description={error.message}
            />
          ) : suppliers.length === 0 ? (
            <EmptyState
              icon={<Factory />}
              title="No suppliers yet"
              description="Add your first supplier to start matching them against incoming tenders."
              action={
                <Can permission="suppliers:write">
                  <SupplierDialog
                    trigger={
                      <Button>
                        <Plus />
                        New supplier
                      </Button>
                    }
                  />
                </Can>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Niches</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead className="text-right">Fit</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((supplier) => {
                    const fit = fitOf(supplier.fitScore);
                    return (
                      <TableRow key={supplier.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-9">
                              <AvatarFallback className="bg-sky-500/10 text-xs font-medium text-sky-400">
                                {initials(supplier.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate font-medium leading-tight">
                              {supplier.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <TagList items={supplier.niches} />
                        </TableCell>
                        <TableCell>
                          <TagList items={supplier.capabilities} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-medium tabular-nums',
                            fitTint(fit),
                          )}
                        >
                          {supplier.fitScore ?? '—'}
                        </TableCell>
                        <TableCell className="max-w-[14rem] truncate text-muted-foreground">
                          {supplier.contact ?? '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Can permission="suppliers:write">
                            <SupplierDialog
                              supplier={supplier}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Edit supplier"
                                >
                                  <Pencil />
                                </Button>
                              }
                            />
                          </Can>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Render a string[] as small badges, with a graceful dash when empty.
function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant="secondary" className="font-normal">
          {item}
        </Badge>
      ))}
    </div>
  );
}
