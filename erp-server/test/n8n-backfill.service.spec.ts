import {
  extractMetrics,
  touchedFolderIds,
  resolveTouchedCampaign,
} from '../src/arsenal/n8n-backfill.service';

// These pin the per-stage metric extraction against the runData shapes verified
// from live n8n executions. The node names + paths here mirror reality, so a
// rename in a workflow that breaks extraction will break a test (not silently
// produce zeros in production).

// One node "run" whose main[0] output is the given json items.
function run(items: Array<Record<string, unknown>>) {
  return { data: { main: [items.map((json) => ({ json }))] } };
}
// N runs of a node (for run-count metrics like emails/templates/meetings).
function runs(n: number) {
  return Array.from({ length: n }, () => run([{}]));
}

describe('extractMetrics — per-stage funnel counts', () => {
  it('LEAD_SATELLITE: leadsFound = Append Leads Rows item count + campaign folder', () => {
    const rd = {
      'Append Leads Rows': [run(Array.from({ length: 6 }, () => ({})))],
      'Decide: Should Hunt?': [run([{ campaignFolderId: 'F1', project: 'X' }])],
    };
    expect(extractMetrics('LEAD_SATELLITE', rd)).toEqual({
      metrics: { leadsFound: 6 },
      campaignFolderId: 'F1',
    });
  });

  it('AMMO_FORGE: templatesForged = Upload Template Doc run count + folder', () => {
    const rd = {
      'Upload Template Doc': runs(1),
      'Merge To Single Doc': [run([{ campaignFolderId: 'F2' }])],
    };
    expect(extractMetrics('AMMO_FORGE', rd)).toEqual({
      metrics: { templatesForged: 1 },
      campaignFolderId: 'F2',
    });
  });

  it('REACH_BAZOOKA: emailsSent = Gmail send run count (global, no folder)', () => {
    const rd = { 'Gmail — Send Outreach': runs(3) };
    expect(extractMetrics('REACH_BAZOOKA', rd)).toEqual({
      metrics: { emailsSent: 3 },
      campaignFolderId: null,
    });
  });

  it('REPLY_GLOCK: repliesHandled = interested+unsure+notInterested; meetings = calendar runs', () => {
    const rd = {
      'Code — Aggregate Daily Counts': [
        run([{ interested: 2, unsure: 1, notInterested: 4, scheduled: 9 }]),
      ],
      'Calendar — Create Meeting': runs(2),
    };
    expect(extractMetrics('REPLY_GLOCK', rd)).toEqual({
      metrics: { repliesHandled: 7, meetingsBooked: 2 },
      campaignFolderId: null,
    });
  });

  it('SLEEPER_GRENADE: leadsSwept = Build Summary snoozed+deleted', () => {
    const rd = {
      'Build Summary': [run([{ snoozed: 1, deleted: 1, skipped: 0 }])],
    };
    expect(extractMetrics('SLEEPER_GRENADE', rd)).toEqual({
      metrics: { leadsSwept: 2 },
      campaignFolderId: null,
    });
  });

  it('SLEEPER_GRENADE: falls back to summing Record Result when no Build Summary', () => {
    const rd = {
      'Record Result': [
        run([{ campaign: 'A', snoozed: 1, deleted: 0 }]),
        run([{ campaign: 'B', snoozed: 2, deleted: 1 }]),
      ],
    };
    expect(extractMetrics('SLEEPER_GRENADE', rd).metrics).toEqual({
      leadsSwept: 4,
    });
  });

  it('tolerates missing nodes — zeros, never throws', () => {
    expect(extractMetrics('LEAD_SATELLITE', {})).toEqual({
      metrics: { leadsFound: 0 },
      campaignFolderId: null,
    });
    expect(extractMetrics('REPLY_GLOCK', {})).toEqual({
      metrics: { repliesHandled: 0, meetingsBooked: 0 },
      campaignFolderId: null,
    });
  });
});

describe('touchedFolderIds — campaigns a (global) run touched', () => {
  it('collects distinct campaignFolderId across nodes; ignores items without it', () => {
    const rd = {
      'Code — Explode Campaigns': [run([{ campaignFolderId: 'F1' }])],
      'Code — Compute Action': [
        run([{ campaignFolderId: 'F1' }, { campaignFolderId: 'F1' }]),
      ],
      // raw Drive listing shape (id/name) must NOT leak in
      'Drive — List Campaign Folders': [run([{ id: 'XYZ', name: 'whatever' }])],
    };
    expect(touchedFolderIds(rd).sort()).toEqual(['F1']);
  });

  it('returns every distinct folder when a run spans several campaigns', () => {
    const rd = {
      'Code — Explode Campaigns': [
        run([{ campaignFolderId: 'F1' }, { campaignFolderId: 'F2' }]),
      ],
    };
    expect(touchedFolderIds(rd).sort()).toEqual(['F1', 'F2']);
  });

  it('empty runData → []', () => {
    expect(touchedFolderIds({})).toEqual([]);
  });
});

describe('resolveTouchedCampaign — attribute only when exactly one ERP campaign', () => {
  const byFolder = new Map([
    ['F1', { id: 'c1' }],
    ['F2', { id: 'c2' }],
  ]);

  it('one matched campaign → that campaign', () => {
    expect(resolveTouchedCampaign(['F1', 'F1'], byFolder)).toEqual({ id: 'c1' });
  });

  it('two distinct matched campaigns → null (stays org-wide)', () => {
    expect(resolveTouchedCampaign(['F1', 'F2'], byFolder)).toBeNull();
  });

  it('folders matching no ERP campaign → null', () => {
    expect(resolveTouchedCampaign(['ZZZ'], byFolder)).toBeNull();
  });

  it('extra unknown folders ignored when one campaign matches', () => {
    expect(resolveTouchedCampaign(['F1', 'ZZZ'], byFolder)).toEqual({ id: 'c1' });
  });
});
