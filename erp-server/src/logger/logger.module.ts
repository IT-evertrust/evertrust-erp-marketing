import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

// Structured request logging. Every request gets a stable `requestId` (honors an
// inbound x-request-id, else generates one) which is echoed on the response and
// reused as the audit correlationId — one id threads logs + audit + client.
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const existing = req.headers['x-request-id'];
          const id =
            (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        customProps: (req: IncomingMessage) => ({
          requestId: (req as IncomingMessage & { id?: string }).id,
        }),
        // Quiet, readable logs in dev; raw JSON in prod (pipe to a collector).
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:standard' },
              },
        // Never log Authorization headers or cookies.
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
  ],
})
export class LoggerModule {}
