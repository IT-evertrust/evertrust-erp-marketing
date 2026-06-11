import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PersonasService } from '../src/meetings/personas.service';

function svc(apiUrl = 'https://n8n.test') {
  const config = {
    get: (k: string) => (k === 'N8N_API_URL' ? apiUrl : ''),
  } as unknown as ConfigService;
  return new PersonasService(config);
}

describe('PersonasService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('lists Drive-folder personas (via n8n) with the folder URL', async () => {
    const service = svc();
    let calledUrl = '';
    global.fetch = (async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          folderUrl: 'https://drive.google.com/drive/folders/abc',
          personas: [
            { id: 'f1', name: 'Alex Hormozi' },
            { id: 'f2', name: 'Kanye West' },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const r = await service.list();
    expect(calledUrl).toBe('https://n8n.test/webhook/erp-sales-personas');
    expect(r.folderUrl).toBe('https://drive.google.com/drive/folders/abc');
    expect(r.personas.map((p) => p.name)).toEqual(['Alex Hormozi', 'Kanye West']);
  });

  it('throws ServiceUnavailable when the workflow returns non-200', async () => {
    const service = svc();
    global.fetch = (async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(service.list()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailable when N8N_API_URL is unset', async () => {
    const service = svc('');
    await expect(service.list()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
