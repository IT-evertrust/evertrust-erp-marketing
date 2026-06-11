import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PersonaListDto } from '@evertrust/shared';

// Coaching personas live as Google Docs in the Drive "AI Personas" folder. The
// ERP has no Google creds, so it lists them through the Sales Agent workflow's
// read-only entry (same host as N8N_API_URL).
const PERSONAS_WEBHOOK_PATH = 'erp-sales-personas';
const REQUEST_TIMEOUT_MS = 20000;

interface RawPersona {
  id?: string;
  name?: string;
}

@Injectable()
export class PersonasService {
  private readonly logger = new Logger(PersonasService.name);
  constructor(private readonly config: ConfigService) {}

  // The Drive folder's persona docs (name + Drive file id) plus the folder URL
  // (for the "open folder" button). Refresh = re-call this.
  async list(): Promise<PersonaListDto> {
    const url = this.webhookUrl();
    if (!url) {
      throw new ServiceUnavailableException(
        'Persona source is not configured (set N8N_API_URL).',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Persona list returned HTTP ${res.status}.`,
        );
      }
      const json = (await res.json()) as {
        folderUrl?: unknown;
        personas?: RawPersona[];
      };
      const personas = Array.isArray(json?.personas)
        ? json.personas
            .filter((p) => p && typeof p.name === 'string' && p.name.length > 0)
            .map((p) => ({ id: String(p.id ?? p.name), name: String(p.name) }))
        : [];
      return {
        folderUrl: typeof json?.folderUrl === 'string' ? json.folderUrl : null,
        personas,
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `personas GET ${url} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      throw new ServiceUnavailableException(
        'Persona list call failed — check that the Sales Agent workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private webhookUrl(): string {
    const explicit = (
      this.config.get('N8N_SALES_PERSONAS_WEBHOOK_URL') ?? ''
    ).trim();
    if (explicit) return explicit;
    const base = (this.config.get('N8N_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    return base ? `${base}/webhook/${PERSONAS_WEBHOOK_PATH}` : '';
  }
}
