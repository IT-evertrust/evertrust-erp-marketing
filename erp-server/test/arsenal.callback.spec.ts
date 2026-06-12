import { ArsenalController } from '../src/arsenal/arsenal.controller';
import type { ArsenalService } from '../src/arsenal/arsenal.service';
import type { ArsenalScheduler } from '../src/arsenal/arsenal.scheduler';
import type { N8nExecutionsService } from '../src/arsenal/n8n-executions.service';
import type { N8nBackfillService } from '../src/arsenal/n8n-backfill.service';
import type { AppConfigService } from '../src/config/app-config.service';
import type { ArsenalCallbackBodyDto } from '../src/arsenal/arsenal.dto';

// The callback route's token gate now lives in ArsenalTokenGuard (see
// arsenal-token.guard.spec.ts). These tests pin the CONTROLLER's job: forward the
// body to recordCallback and ack with the recorded run id. The token is no longer
// checked in the handler.
const RUN_ID = '11111111-1111-1111-1111-111111111111';

function makeController() {
  const recordCallback = jest.fn().mockResolvedValue({ id: RUN_ID });
  const arsenal = { recordCallback } as unknown as ArsenalService;
  const scheduler = {} as ArsenalScheduler;
  const n8nExec = {} as N8nExecutionsService;
  const backfill = {} as N8nBackfillService;
  const config = { get: () => '' } as unknown as AppConfigService;
  return {
    controller: new ArsenalController(
      arsenal,
      scheduler,
      n8nExec,
      backfill,
      config,
    ),
    recordCallback,
  };
}

const body: ArsenalCallbackBodyDto = {
  stage: 'LEAD_SATELLITE',
  status: 'SUCCESS',
  campaignId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
} as ArsenalCallbackBodyDto;

describe('ArsenalController — runs/callback handler', () => {
  it('forwards the body to recordCallback and acks with the run id', async () => {
    const { controller, recordCallback } = makeController();
    const res = await controller.callback(body);
    expect(res).toEqual({ ok: true, id: RUN_ID });
    expect(recordCallback).toHaveBeenCalledWith({
      stage: 'LEAD_SATELLITE',
      status: 'SUCCESS',
      campaignId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      driveFolderId: undefined,
      detail: undefined,
      metrics: undefined,
    });
  });
});
