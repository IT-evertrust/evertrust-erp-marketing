'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationDto } from '@evertrust/shared';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useUnreadNotifications,
} from '@/hooks/use-notifications';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/arsenal-sequence';

// The topbar notification bell. Polls the unread feed every 30s; when the unread
// count INCREASES it plays a one-shot bell shake + a badge pop (both respect
// prefers-reduced-motion via globals.css). Clicking opens a dropdown of unread
// notifications; clicking one marks it read and follows its link.
export function NotificationBell() {
  const router = useRouter();
  const { data, isLoading, isError } = useUnreadNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data ?? [];
  const count = items.length;

  // Animate only when the count grows (a new notification arrived) — never on the
  // first load or when items are cleared by reading them.
  const prevCount = useRef(count);
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    if (count > prevCount.current) setAnimating(true);
    prevCount.current = count;
  }, [count]);

  function openLink(n: NotificationDto) {
    markRead.mutate(n.id);
    if (n.link) router.push(n.link);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative shrink-0 text-muted-foreground"
          aria-label={
            count > 0 ? `Notifications, ${count} unread` : 'Notifications'
          }
        >
          <Bell
            className={cn(animating && 'origin-top animate-bell-shake')}
            onAnimationEnd={() => setAnimating(false)}
          />
          {count > 0 ? (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white',
                animating && 'animate-badge-pop',
              )}
            >
              {count > 9 ? '9+' : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {count > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck />
              Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto border-t p-1">
          {isLoading ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : isError ? (
            <p className="px-2 py-6 text-center text-sm text-destructive">
              Couldn’t load notifications.
            </p>
          ) : count === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nothing new
            </p>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
                onSelect={() => openLink(n)}
              >
                <span className="text-sm font-medium text-foreground">
                  {n.title}
                </span>
                {n.body ? (
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {n.body}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted-foreground/70">
                  {timeAgo(n.createdAt)}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
