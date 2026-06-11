'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { useTenderAssignment, useAssignTender } from '@/hooks/use-tenders';
import { useUsers } from '@/hooks/use-users';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/tender-format';

// Phase 4 (R21): the tender's PIC assignment. Shows the current assignee (name,
// when, reason) or "Unassigned", with an Assign action gated by tenders:assign.
export function TenderAssigneeCard({ tenderId }: { tenderId: string }) {
  const assignment = useTenderAssignment(tenderId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assignee</CardTitle>
        <Can permission="tenders:assign">
          <CardAction>
            <AssignDialog tenderId={tenderId} />
          </CardAction>
        </Can>
      </CardHeader>
      <CardContent>
        {assignment.isLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : assignment.data ? (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                PIC
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {assignment.data.picName}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Assigned
              </dt>
              <dd className="mt-1 text-sm">
                {formatDateTime(assignment.data.assignedAt)}
              </dd>
            </div>
            {assignment.data.reason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Reason
                </dt>
                <dd className="mt-1 text-sm text-muted-foreground">
                  {assignment.data.reason}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Unassigned</p>
        )}
      </CardContent>
    </Card>
  );
}

// Assign dialog: pick an org user (PIC) + optional reason, then POST the
// assignment. The org directory comes from GET /users (tenant-scoped).
function AssignDialog({ tenderId }: { tenderId: string }) {
  const [open, setOpen] = useState(false);
  const [picId, setPicId] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState('');
  const users = useUsers();
  const assign = useAssignTender(tenderId);

  function submit() {
    if (!picId) {
      toast.error('Select a person to assign.');
      return;
    }
    assign.mutate(
      { picId, reason: reason.trim() || undefined },
      {
        onSuccess: (a) => {
          toast.success(`Assigned to ${a.picName}.`);
          setOpen(false);
          setReason('');
          setPicId(undefined);
        },
        onError: (error) => toast.error(error.message ?? 'Could not assign.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus />
          Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign tender</DialogTitle>
          <DialogDescription>
            Assign this tender to a person in your organization. Any existing
            assignment is superseded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="assignee">Assignee</Label>
            <Select value={picId} onValueChange={setPicId}>
              <SelectTrigger id="assignee" className="w-full">
                <SelectValue placeholder="Select a person" />
              </SelectTrigger>
              <SelectContent>
                {users.data?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this person?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={assign.isPending}>
            {assign.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
