'use client';

import { GrowthCard, StatusPill } from '../../shared';

import type { SenderSchedule } from '../types';

type DailySend = {
  date: string;
  value: number;
  type: string;
};

type SequenceSenderPanelProps = {
  schedule: SenderSchedule[];
  dailySends: DailySend[];
  onToggleAutoSend: (aimId: string) => void;
  onRunBazooka: () => void;
  bazookaRunning?: boolean;
};

export function SequenceSenderPanel({
  schedule,
  dailySends,
  onToggleAutoSend,
  onRunBazooka,
  bazookaRunning = false,
}: SequenceSenderPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GrowthCard
        title="Campaigns"
        hint={
          <button
            type="button"
            onClick={onRunBazooka}
            disabled={bazookaRunning}
            className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-60"
          >
            {bazookaRunning ? 'Running…' : 'Run Bazooka'}
          </button>
        }
      >
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Campaign
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Niche / Region
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Round
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Next Send
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Status
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Sent
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Opened
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Replied
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Meetings
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Bazooka
              </th>
            </tr>
          </thead>

          <tbody>
            {schedule.map((item) => (
              <tr
                key={item.id}
                className="border-t border-border hover:bg-muted"
              >
                <td className="px-3 py-3 text-[12.5px] font-bold text-foreground">
                  {item.campaign}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                  {item.nicheRegion}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                  {item.round}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                  {item.nextSend}
                </td>
                <td className="px-3 py-3">
                  <StatusPill live={item.status !== 'NEW' && item.status !== 'OVER'}>
                    {item.status}
                  </StatusPill>
                </td>
                <td className="px-3 py-3 text-right text-[12.5px] font-bold text-foreground">
                  {item.sent}
                </td>
                <td className="px-3 py-3 text-right text-[12.5px] text-muted-foreground">
                  {item.opened}
                </td>
                <td className="px-3 py-3 text-right text-[12.5px] text-muted-foreground">
                  {item.replied}
                </td>
                <td className="px-3 py-3 text-right text-[12.5px] text-muted-foreground">
                  {item.meetings}
                </td>
                <td className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onToggleAutoSend(item.id)}
                    className={[
                      'rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] transition-colors',
                      item.autoSend
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    {item.autoSend ? 'On' : 'Off'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GrowthCard>

      <GrowthCard title="Emails sent per day" hint="PAST & PROJECTED · LIMIT 120 / DAY">
        <div className="relative h-[220px]">
          <div className="absolute left-0 right-0 top-[28px] border-t border-dashed border-border">
            <span className="absolute right-0 top-[-8px] bg-card px-2 text-[8px] font-bold text-muted-foreground">
              120 LIMIT
            </span>
          </div>

          <div className="flex h-[180px] items-end gap-3 overflow-x-auto pt-5">
            {dailySends.map((day) => {
              const height = Math.min(100, (day.value / 130) * 100);
              const isFuture = day.type === 'future';
              const isToday = day.type === 'today';

              return (
                <div
                  key={day.date}
                  className="flex h-full min-w-[46px] flex-col items-center justify-end"
                >
                  <span className="mb-1 text-[9px] font-bold text-muted-foreground">
                    {day.value}
                  </span>
                  <div
                    className={[
                      'w-9 rounded-t',
                      isFuture
                        ? 'border border-dashed border-border bg-transparent'
                        : isToday
                          ? 'bg-muted-foreground'
                          : 'bg-foreground',
                    ].join(' ')}
                    style={{ height: `${height}%` }}
                  />
                  <span className="mt-1 text-[8.5px] font-bold text-muted-foreground">
                    {day.date}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          <span>■ Sent</span>
          <span>■ Today</span>
          <span>□ Projected</span>
        </div>
      </GrowthCard>
    </div>
  );
}