'use client';

import { Loader2 } from 'lucide-react';
import type { ContractDto, ContractStatus } from '@evertrust/shared';
import { useContracts } from '@/hooks/use-contracts';
import { LiveDot } from '@/modules/(growth)/shared';
import { formatDateTime } from '@/lib/tender-format';

// The four contract templates from the attached design. Static — there is no
// template-management API yet, so these are presentational entries.
const TEMPLATES = [
  'Framework contract (Housing)',
  'Pilot quote (Municipality)',
  'Reseller terms',
  'Single order',
];

// SIGNED reads as the "live" (filled-dot) status in the design; everything else
// shows the hollow dot.
const LIVE_STATUSES: ContractStatus[] = ['SIGNED'];

// Nurture › Contract Assist, faithful to the attached design and white-themed:
// a Contract Assistant draft card + a Templates list on top, then the real
// Quotes & Contracts table below (GET /contracts, scoped to the campaign).
export function ContractAssist({ campaignId }: { campaignId: string }) {
  const q = useContracts({ campaignId }, !!campaignId);
  const contracts = q.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Assistant + Templates */}
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card title="Contract Assistant" hint="TEMPLATE PREVIEW">
          <div className="rounded-[10px] border border-[#c2c7ce] bg-white p-[13px_15px]">
            <div className="mb-2 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
              <LiveDot />
              Framework contract · Housing · template
            </div>
            <p className="text-[13px] leading-[1.55] text-[#15171c]">
              §1 Scope of supply: balcony-solar sets incl. micro-inverter …
              <br />
              §2 Tiered price: net per set, volume tiers from 100 pcs …
              <br />
              §3 Delivery time: 4–6 weeks from order …
              <br />
              §4 Mounting-partner referral optional …
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <GhostButton disabled title="Contract generation API coming soon">
                Edit
              </GhostButton>
              <GhostButton disabled title="Contract generation API coming soon">
                As PDF
              </GhostButton>
              <SolidButton
                disabled
                title="Contract generation API coming soon"
              >
                Send for signature
              </SolidButton>
            </div>
          </div>
        </Card>

        <Card title="Templates">
          <div className="flex flex-col">
            {TEMPLATES.map((tpl) => (
              <div
                key={tpl}
                className="flex items-center justify-between border-b border-dashed border-[#d6dade] py-[7px] text-[12.5px] last:border-b-0"
              >
                <span className="text-[#959ca7]">{tpl}</span>
                <b className="text-[#15171c]">›</b>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Quotes & Contracts — real data */}
      <Card
        title="Quotes & Contracts"
        action={
          q.isFetching ? (
            <Loader2 className="size-4 animate-spin text-[#959ca7]" />
          ) : null
        }
      >
        {q.isLoading ? (
          <div className="flex items-center justify-center py-10 text-[12.5px] font-bold text-[#959ca7]">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading contracts…
          </div>
        ) : q.isError ? (
          <p className="py-8 text-center text-[12.5px] font-bold text-[#b91c1c]">
            Couldn’t load contracts. {q.error.message}
          </p>
        ) : contracts.length === 0 ? (
          <p className="rounded-[8px] border border-dashed border-[#d6dade] px-4 py-8 text-center text-[12.5px] font-bold text-[#959ca7]">
            No quotes or contracts for this campaign yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['TERM', 'CREATED', 'SIGNED', 'FILE', 'STATUS'].map((h) => (
                    <th
                      key={h}
                      className="px-3 pb-2.5 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <ContractRow key={c.id} contract={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ContractRow({ contract: c }: { contract: ContractDto }) {
  return (
    <tr className="hover:bg-[#f6f7f9]">
      <td className="border-t border-[#e4e7eb] p-3 text-[12.5px] font-bold text-[#15171c]">
        {c.cooperationTerm || '—'}
      </td>
      <td className="border-t border-[#e4e7eb] p-3 text-[12.5px] tabular-nums text-[#5b626d]">
        {formatDateTime(c.createdAt)}
      </td>
      <td className="border-t border-[#e4e7eb] p-3 text-[12.5px] tabular-nums text-[#5b626d]">
        {c.signedAt ? formatDateTime(c.signedAt) : '—'}
      </td>
      <td className="border-t border-[#e4e7eb] p-3 text-[12.5px] text-[#5b626d]">
        {c.driveUrl ? (
          <a
            href={c.driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-[#15171c] underline-offset-2 hover:underline"
          >
            Open
          </a>
        ) : (
          '—'
        )}
      </td>
      <td className="border-t border-[#e4e7eb] p-3">
        <StatusBadge status={c.status} />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: ContractStatus }) {
  const live = LIVE_STATUSES.includes(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#5b626d]">
      <span
        className={[
          'inline-block size-1.5 rounded-full',
          live ? 'bg-[#15171c]' : 'bg-[#959ca7]',
        ].join(' ')}
      />
      {status}
    </span>
  );
}

// ---- white-theme card primitives matching the design's `.card` ----
function Card({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-[10px] border border-[#e4e7eb] bg-white">
      <div className="flex items-center justify-between border-b border-[#e4e7eb] px-4 py-[15px]">
        <h3 className="text-[13.5px] font-bold text-[#15171c]">{title}</h3>
        {hint ? (
          <span className="text-[10px] uppercase tracking-[0.06em] text-[#959ca7]">
            {hint}
          </span>
        ) : null}
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function GhostButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
  },
) {
  const { children, className, ...rest } = props;
  return (
    <button
      type="button"
      className={[
        'rounded-[7px] border border-[#c2c7ce] bg-transparent px-[11px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c] disabled:cursor-not-allowed disabled:opacity-50',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

function SolidButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
  },
) {
  const { children, className, ...rest } = props;
  return (
    <button
      type="button"
      className={[
        'rounded-[7px] border border-[#15171c] bg-[#15171c] px-[11px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-white disabled:cursor-not-allowed disabled:opacity-50',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
