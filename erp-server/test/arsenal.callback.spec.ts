import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ArsenalController } from '../src/arsenal/arsenal.controller';
import type { ArsenalService } from '../src/arsenal/arsenal.service';
import type { ArsenalScheduler } from '../src/arsenal/arsenal.scheduler';
import type { N8nExecutionsService } from '../src/arsenal/n8n-executions.service';
import type { N8nBackfillService } from '../src/arsenal/n8n-backfill.service';
import type { AppConfigService } from '../src/config/app-config.service';
import type { ArsenalCallbackBodyDto } from '../src/arsenal/arsenal.dto';

// The callback is PUBLIC (no JWT) — its ONLY auth is the shared ingest token in the
// x-arsenal-token header. These tests pin that boundary: off by default (503),
// rejects a bad/absent token (401), and only records on an exact match.
const TOKEN = 'super-secret-ingest-token';
const RUN_ID = '11111111-1111-1111-1111-111111111111';

function makeController(token: string) {
  const recordCallback = jest.fn().mockResolvedValue({ id: RUN_ID });
  const arsenal = { recordCallback } as unknown as ArsenalService;
  const scheduler = {} as ArsenalScheduler;
  const n8nExec = {} as N8nExecutionsService;
  const backfill = {} as N8nBackfillService;
  const config = {
    get: (k: string) => (k === 'ARSENAL_INGEST_TOKEN' ? token : ''),
  } as unknown as AppConfigService;
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

function reqWith(headerToken?: string): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === 'x-arsenal-token' ? headerToken : undefined,
  } as unknown as Request;
}

const body: ArsenalCallbackBodyDto = {
  stage: 'LEAD_SATELLITE',
  status: 'SUCCESS',
  campaignId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
} as ArsenalCallbackBodyDto;

describe('ArsenalController — callback token gate', () => {
  it('503s when no ingest token is configured (feature off by default)', async () => {
    const { controller, recordCallback } = makeController('');
    await expect(controller.callback(body, reqWith(TOKEN))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(recordCallback).not.toHaveBeenCalled();
  });

  it('401s when the header token is missing', async () => {
    const { controller, recordCallback } = makeController(TOKEN);
    await expect(controller.callback(body, reqWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(recordCallback).not.toHaveBeenCalled();
  });

  it('401s when the header token is wrong', async () => {
    const { controller, recordCallback } = makeController(TOKEN);
    await expect(
      controller.callback(body, reqWith('not-the-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(recordCallback).not.toHaveBeenCalled();
  });

  it('records + acks when the token matches exactly', async () => {
    const { controller, recordCallback } = makeController(TOKEN);
    const res = await controller.callback(body, reqWith(TOKEN));
    expect(res).toEqual({ ok: true, id: RUN_ID });
    expect(recordCallback).toHaveBeenCalledWith({
      stage: 'LEAD_SATELLITE',
      status: 'SUCCESS',
      campaignId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      driveFolderId: undefined,
      detail: undefined,
    });
  });
});
