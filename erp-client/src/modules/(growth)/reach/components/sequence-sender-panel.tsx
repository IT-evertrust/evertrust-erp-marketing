'use client';

import { useTranslations } from 'next-intl';

import { GrowthCard, StatusPill } from '../../shared';

import type { DailySend, SenderSchedule } from '../types';

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
  const t = useTranslations('reach');

  return (
    <div className="flex flex-col gap-4">
      <GrowthCard
        title={t('sender.campaignsTitle')}
        hint={
          <button
            type="button"
            onClick={onRunBazooka}
            disabled={bazookaRunning}
            className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-60"
          >
            {bazookaRunning ? t('sender.running') : t('sender.runBazooka')}
          </button>
        }
      >
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.campaign')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.nicheRegion')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.round')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.nextSend')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.status')}
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.sent')}
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.opened')}
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.replied')}
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.meetings')}
              </th>
              <th className="px-3 pb-3 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('sender.col.bazooka')}
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
                  {item.nextSend ?? t('sender.tomorrow')}
                </td>
                <td className="px-3 py-3">
                  <StatusPill live={item.status !== 'NEW' && item.status !== 'OVER'}>
                    {t(`campaignTable.status.${item.status}`)}
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
                    {item.autoSend ? t('sender.on') : t('sender.off')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GrowthCard>

      <GrowthCard title={t('sender.chartTitle')} hint={t('sender.chartHint')}>
        <div className="relative h-[220px]">
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
                    {isToday ? t('sender.legend.today') : day.date}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          <span>■ {t('sender.legend.sent')}</span>
          <span>■ {t('sender.legend.today')}</span>
          <span>□ {t('sender.legend.projected')}</span>
        </div>
      </GrowthCard>
    </div>
  );
}