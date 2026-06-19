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
};

export function SequenceSenderPanel({
  schedule,
  dailySends,
}: SequenceSenderPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GrowthCard title="Campaigns">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Campaign
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Niche / Region
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Round
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Next Send
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Status
              </th>
            </tr>
          </thead>

          <tbody>
            {schedule.map((item) => (
              <tr
                key={item.id}
                className="border-t border-[#e4e7eb] hover:bg-[#f6f7f9]"
              >
                <td className="px-3 py-3 text-[12.5px] font-bold text-[#15171c]">
                  {item.campaign}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                  {item.nicheRegion}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                  {item.round}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-[#5b626d]">
                  {item.nextSend}
                </td>
                <td className="px-3 py-3">
                  <StatusPill live={item.status !== 'NEW' && item.status !== 'OVER'}>
                    {item.status}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GrowthCard>

      <GrowthCard title="Emails sent per day" hint="PAST & PROJECTED · LIMIT 120 / DAY">
        <div className="relative h-[220px]">
          <div className="absolute left-0 right-0 top-[28px] border-t border-dashed border-[#c2c7ce]">
            <span className="absolute right-0 top-[-8px] bg-white px-2 text-[8px] font-bold text-[#959ca7]">
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
                  <span className="mb-1 text-[9px] font-bold text-[#5b626d]">
                    {day.value}
                  </span>
                  <div
                    className={[
                      'w-9 rounded-t',
                      isFuture
                        ? 'border border-dashed border-[#c2c7ce] bg-transparent'
                        : isToday
                          ? 'bg-[#959ca7]'
                          : 'bg-[#15171c]',
                    ].join(' ')}
                    style={{ height: `${height}%` }}
                  />
                  <span className="mt-1 text-[8.5px] font-bold text-[#959ca7]">
                    {day.date}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-[9px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
          <span>■ Sent</span>
          <span>■ Today</span>
          <span>□ Projected</span>
        </div>
      </GrowthCard>
    </div>
  );
}