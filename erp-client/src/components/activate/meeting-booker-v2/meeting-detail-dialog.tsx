'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { CalendarEventDto } from '@evertrust/shared';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// A calendar event tagged with the connected mailbox it was read from (so an edit
// writes back to the SAME Google account).
export type AccountEvent = CalendarEventDto & { accountId: string };

type MeetingDetailDialogProps = {
  event: AccountEvent | null;
  accountEmail: string;
  accountColor: string;
  onClose: () => void;
  // Called after a successful edit so the grid can refetch from Google.
  onSaved: () => void;
};

// An ISO instant → the value a <input type="datetime-local"> expects
// ("YYYY-MM-DDTHH:mm"), in the browser's local time.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// A human "Mon, 23 Jun · 14:00 – 15:00" label for the read view.
function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) return '';
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(start);
  const clock = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day} · ${clock(start)} – ${clock(end)}`;
}

// The meeting mini-form — same dialog primitives as the AIM/new-campaign modal.
// Read mode shows the meeting + a "Join meeting" link; Edit mode writes the change
// back to the real Google Calendar event on its own mailbox.
export function MeetingDetailDialog({
  event,
  accountEmail,
  accountColor,
  onClose,
  onSaved,
}: MeetingDetailDialogProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    start: '',
    end: '',
    location: '',
    description: '',
  });

  // Reset the form to the event whenever a new one is opened (and leave edit mode).
  useEffect(() => {
    if (!event) return;
    setEditing(false);
    setForm({
      title: event.title ?? '',
      start: toLocalInput(event.start),
      end: toLocalInput(event.end),
      location: event.location ?? '',
      description: event.description ?? '',
    });
  }, [event]);

  if (!event) return null;

  async function onSave() {
    if (!event) return;
    if (!form.title.trim()) {
      toast.error('A title is required.');
      return;
    }
    const start = new Date(form.start);
    const end = new Date(form.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error('Please enter a valid start and end time.');
      return;
    }
    if (end <= start) {
      toast.error('The end time must be after the start time.');
      return;
    }

    setSaving(true);
    try {
      const result = await api.meetings.updateCalendarEvent(
        event.id,
        {
          title: form.title.trim(),
          start: start.toISOString(),
          end: end.toISOString(),
          location: form.location.trim() || undefined,
          description: form.description.trim() || undefined,
        },
        event.accountId,
      );
      if (!result.ok) {
        toast.error(result.reason ?? 'Could not update the meeting.');
        return;
      }
      toast.success('Meeting updated in Google Calendar.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the meeting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={event !== null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: accountColor }}
            />
            {editing ? 'Edit meeting' : event.title}
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="grid gap-5 py-1">
            <div className="grid gap-2">
              <Label htmlFor="mtg-title">Title</Label>
              <Input
                id="mtg-title"
                value={form.title}
                maxLength={300}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mtg-start">Start</Label>
              <Input
                id="mtg-start"
                type="datetime-local"
                value={form.start}
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mtg-end">End</Label>
              <Input
                id="mtg-end"
                type="datetime-local"
                value={form.end}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mtg-location">Location</Label>
              <Input
                id="mtg-location"
                value={form.location}
                maxLength={500}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mtg-desc">Description</Label>
              <Textarea
                id="mtg-desc"
                value={form.description}
                rows={4}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 py-1 text-[13px] text-foreground">
            <div className="text-muted-foreground">{formatRange(event.start, event.end)}</div>
            <div className="text-[12px] text-muted-foreground">
              Calendar: <span className="font-medium text-foreground">{accountEmail}</span>
            </div>
            {event.location ? (
              <div>
                <span className="text-muted-foreground">Location: </span>
                {event.location}
              </div>
            ) : null}
            {event.attendees.length > 0 ? (
              <div>
                <span className="text-muted-foreground">Attendees: </span>
                {event.attendees.join(', ')}
              </div>
            ) : null}
            {event.description ? (
              <div className="whitespace-pre-wrap text-[12.5px] text-muted-foreground">
                {event.description}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="button" onClick={onSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save changes
              </Button>
            </>
          ) : (
            <>
              {event.meetingUrl ? (
                <Button type="button" asChild>
                  <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Join meeting
                  </a>
                </Button>
              ) : (
                <span />
              )}
              <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
