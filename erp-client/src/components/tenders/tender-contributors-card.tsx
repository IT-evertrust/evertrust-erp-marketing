'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, X } from 'lucide-react';
import {
  ContributionRole,
  type ContributionRole as Role,
} from '@evertrust/shared';
import {
  useAddContribution,
  useRemoveContribution,
  useTenderContributions,
} from '@/hooks/use-performance';
import { useUsers } from '@/hooks/use-users';
import { Can } from '@/components/auth/can';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const ROLES = ContributionRole.options;

// Revenue attribution for a tender: who played each role (Research → Qualification
// → Validation → Sales → Account Manager). VALIDATION is auto-seeded from the
// pricing approver / submitter; the rest are added by hand. Feeds contribution
// scoring for bonuses.
export function TenderContributorsCard({ tenderId }: { tenderId: string }) {
  const t = useTranslations('tenders');
  const contributions = useTenderContributions(tenderId);
  const users = useUsers();
  const add = useAddContribution(tenderId);
  const remove = useRemoveContribution(tenderId);
  const [role, setRole] = useState<Role>('RESEARCH');
  const [userId, setUserId] = useState('');

  const rows = contributions.data ?? [];
  const userList = users.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('contributors.title')}</CardTitle>
        <CardDescription>
          {t('contributors.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {ROLES.map((r) => {
            const people = rows.filter((c) => c.role === r);
            return (
              <div key={r} className="grid grid-cols-[130px_1fr] items-start gap-2 text-sm">
                <span className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`contributionRole.${r}`)}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {people.length === 0 ? (
                    <span className="pt-1 text-xs text-muted-foreground/60">{t('contributors.empty')}</span>
                  ) : (
                    people.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-2.5 pr-1 text-[12.5px]"
                      >
                        {c.userName ?? t('contributors.unknown')}
                        <Can permission="performance:write">
                          <button
                            type="button"
                            onClick={() => remove.mutate(c.id)}
                            className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                            aria-label={t('contributors.remove')}
                          >
                            <X className="size-3" />
                          </button>
                        </Can>
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Can permission="performance:write">
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="h-9 rounded-md border bg-card px-2 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`contributionRole.${r}`)}
                </option>
              ))}
            </select>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-9 min-w-[160px] flex-1 rounded-md border bg-card px-2 text-sm"
            >
              <option value="">{t('contributors.selectEmployee')}</option>
              {userList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => {
                if (!userId) return;
                add.mutate(
                  { userId, role },
                  { onSuccess: () => setUserId('') },
                );
              }}
              disabled={!userId || add.isPending}
            >
              {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {t('contributors.add')}
            </Button>
          </div>
        </Can>
        {contributions.isError ? (
          <p className="text-xs text-destructive">{contributions.error.message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
