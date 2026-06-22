// Reach is fully DB-backed now (campaigns, leads, templates, stats all come from
// the backend). The only remaining placeholder is the daily-sends chart, which
// has no real source until the Reach Bazooka sender + send-volume tracking land.
export const DAILY_SENDS = [
  { date: '9/6', value: 88, type: 'past' },
  { date: '10/6', value: 96, type: 'past' },
  { date: '11/6', value: 84, type: 'past' },
  { date: '12/6', value: 110, type: 'past' },
  { date: '13/6', value: 102, type: 'past' },
  { date: '16/6', value: 118, type: 'past' },
  { date: 'Today', value: 88, type: 'today' },
  { date: '18/6', value: 104, type: 'future' },
  { date: '19/6', value: 96, type: 'future' },
  { date: '20/6', value: 82, type: 'future' },
];
