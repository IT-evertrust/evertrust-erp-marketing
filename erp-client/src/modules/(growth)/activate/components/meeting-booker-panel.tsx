import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { CalendarMeeting } from '../types';

type MeetingBookerPanelProps = {
  meetings: CalendarMeeting[];
};

const DAYS = ['MON 16', 'TUE 17', 'WED 18', 'THU 19', 'FRI 20'];
const HOURS = Array.from({ length: 11 }, (_, index) => 8 + index);

export function MeetingBookerPanel({ meetings }: MeetingBookerPanelProps) {
  return (
    <GrowthCard
      title="Calendar · Week 25"
      hint={
        <span className="inline-flex items-center gap-2">
          <LiveDot />
          Google Calendar connected
        </span>
      }
    >
      <div className="overflow-hidden rounded-[10px] border border-[#e4e7eb]">
        <div className="grid grid-cols-[58px_repeat(5,minmax(0,1fr))] border-b border-[#e4e7eb] bg-white">
          <div className="flex items-end justify-end px-2 pb-2 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
            GMT+02
          </div>

          {DAYS.map((day) => {
            const count = meetings.filter((meeting) => meeting.day === day)
              .length;

            return (
              <div
                key={day}
                className="border-l border-[#e4e7eb] px-2 py-2 text-center"
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#5b626d]">
                  {day}
                </div>
                <div className="mt-1 text-[9px] font-bold text-[#959ca7]">
                  {count ? `${count} meeting${count > 1 ? 's' : ''}` : 'free'}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid max-h-[620px] grid-cols-[58px_repeat(5,minmax(0,1fr))] overflow-y-auto">
          <div className="relative bg-white">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="h-14 border-t border-[#e4e7eb] pr-2 text-right text-[9.5px] font-bold text-[#959ca7]"
              >
                <span className="relative top-[-7px]">
                  {hour <= 12 ? `${hour} AM` : `${hour - 12} PM`}
                </span>
              </div>
            ))}
          </div>

          {DAYS.map((day) => (
            <div
              key={day}
              className="relative border-l border-[#e4e7eb] bg-white"
            >
              {HOURS.map((hour) => (
                <div key={hour} className="h-14 border-t border-[#e4e7eb]" />
              ))}

              {meetings
                .filter((meeting) => meeting.day === day)
                .map((meeting) => (
                  <CalendarEvent key={meeting.id} meeting={meeting} />
                ))}
            </div>
          ))}
        </div>
      </div>
    </GrowthCard>
  );
}

function CalendarEvent({ meeting }: { meeting: CalendarMeeting }) {
  const [hour = 0, minute = 0] = meeting.time.split(':').map(Number);
  const top = ((hour - 8) * 56) + (minute / 60) * 56;

  return (
    <div
      className="absolute left-1.5 right-1.5 z-[1] rounded-md border border-[#d6dade] border-l-2 border-l-[#15171c] bg-[#eceef1] px-2 py-1.5"
      style={{ top, minHeight: 54 }}
    >
      <div className="text-[9px] font-bold text-[#959ca7]">{meeting.time}</div>
      <div className="truncate text-[10.5px] font-bold text-[#15171c]">
        {meeting.company}
      </div>
      <div className="truncate text-[9.5px] text-[#959ca7]">
        {meeting.contact} · {meeting.title}
      </div>
    </div>
  );
}