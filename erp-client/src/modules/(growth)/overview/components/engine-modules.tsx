'use client';

import { useEffect, useState } from 'react';

import { GrowthCard } from '@/modules/(growth)/shared';

// The Engine Modules wheel (Overview, top-left in the attached design). Nine R.E.A.N
// workflow modules laid out as a donut of wedges; hovering a wedge lifts that module
// into the center hub AND filters the Engine Activity feed beside it to that module's
// runs, clicking pins the selection, and leaving the wheel restores "all modules".
// Purely presentational — the module set is the fixed product surface, the live data
// is the activity feed it filters.

export type EngineModule = {
  id: string;
  stage: string;
  tag: string;
  key: string;
  name: string;
  desc: string;
  status: string;
};

export const ENGINE_MODULES: EngineModule[] = [
  { id: '01', stage: 'REACH', tag: 'REA', key: 'scraper', name: 'Lead Scraper', desc: 'Pulls and dedupes target companies from directories, registries and search.', status: 'LIVE' },
  { id: '02', stage: 'REACH', tag: 'REA', key: 'generator', name: 'Email Generator', desc: 'Drafts the 3-round outreach emails per campaign, ready for review.', status: 'LIVE' },
  { id: '03', stage: 'REACH', tag: 'REA', key: 'sender', name: 'Sequence Sender', desc: 'Sends the cadence and tracks opens, clicks and replies.', status: 'ALWAYS LIVE' },
  { id: '04', stage: 'ENGAGE', tag: 'ENG', key: 'sorter', name: 'Reply Sorter', desc: 'Classifies inbound replies and drafts the right response.', status: 'ALWAYS LIVE' },
  { id: '05', stage: 'ACTIVATE', tag: 'ACT', key: 'booker', name: 'Meeting Booker', desc: 'Proposes slots and books meetings into Google Calendar.', status: 'LIVE' },
  { id: '06', stage: 'ACTIVATE', tag: 'ACT', key: 'research', name: 'Company Research', desc: 'Builds a one-page dossier on each company before the call.', status: 'LIVE' },
  { id: '07', stage: 'ACTIVATE', tag: 'ACT', key: 'aftersales', name: 'After-Sales Analysis', desc: 'Analyses call recordings via Read AI and extracts next steps.', status: 'LIVE' },
  { id: '08', stage: 'NURTURE', tag: 'NUR', key: 'pipeline', name: 'Sales Pipeline', desc: 'Tracks every deal across the six stages with live values.', status: 'ALWAYS LIVE' },
  { id: '09', stage: 'NURTURE', tag: 'NUR', key: 'contract', name: 'Contract Assist', desc: 'Generates the agreement documents from the agreed terms.', status: 'LIVE' },
];

const N = ENGINE_MODULES.length;
const CX = 300;
const CY = 300;
const RO = 290; // outer radius
const RI = 150; // inner radius (hub edge)
const SEG = 360 / N;
const RIP = 35; // item-label radius, as a % of the square

function deg2rad(d: number) {
  return (d * Math.PI) / 180;
}

// Donut wedge `i`: inner-edge → outer-edge → outer arc → inner arc.
function wedgePath(i: number) {
  const a1 = deg2rad(i * SEG - 90 - SEG / 2);
  const a2 = deg2rad(i * SEG - 90 + SEG / 2);
  const x1o = CX + RO * Math.cos(a1);
  const y1o = CY + RO * Math.sin(a1);
  const x2o = CX + RO * Math.cos(a2);
  const y2o = CY + RO * Math.sin(a2);
  const x1i = CX + RI * Math.cos(a1);
  const y1i = CY + RI * Math.sin(a1);
  const x2i = CX + RI * Math.cos(a2);
  const y2i = CY + RI * Math.sin(a2);
  return `M ${x1i} ${y1i} L ${x1o} ${y1o} A ${RO} ${RO} 0 0 1 ${x2o} ${y2o} L ${x2i} ${y2i} A ${RI} ${RI} 0 0 0 ${x1i} ${y1i} Z`;
}

// Divider spoke on the trailing edge of wedge `i`.
function dividerLine(i: number) {
  const a = deg2rad(i * SEG - 90 + SEG / 2);
  return {
    x1: CX + RI * Math.cos(a),
    y1: CY + RI * Math.sin(a),
    x2: CX + RO * Math.cos(a),
    y2: CY + RO * Math.sin(a),
  };
}

// Inner-edge arc of wedge `i` (hidden while that wedge is active).
function innerArc(i: number) {
  const aa1 = deg2rad(i * SEG - 90 - SEG / 2);
  const aa2 = deg2rad(i * SEG - 90 + SEG / 2);
  const ax1 = CX + RI * Math.cos(aa1);
  const ay1 = CY + RI * Math.sin(aa1);
  const ax2 = CX + RI * Math.cos(aa2);
  const ay2 = CY + RI * Math.sin(aa2);
  return `M ${ax1} ${ay1} A ${RI} ${RI} 0 0 1 ${ax2} ${ay2}`;
}

function itemPosition(i: number) {
  const ang = deg2rad(i * SEG - 90);
  return { left: `${50 + RIP * Math.cos(ang)}%`, top: `${50 + RIP * Math.sin(ang)}%` };
}

type EngineModulesProps = {
  // Lifts the currently-focused module (hovered, else pinned, else null) so the page
  // can filter the activity feed alongside it.
  onActiveChange?: (module: EngineModule | null) => void;
};

export function EngineModules({ onActiveChange }: EngineModulesProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);

  const activeIndex = hovered ?? pinned;
  const active = activeIndex == null ? null : ENGINE_MODULES[activeIndex] ?? null;

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  return (
    <GrowthCard title="Engine Modules" className="flex h-full flex-col">
      <style>{WHEEL_CSS}</style>
      <div className="flex min-h-[420px] flex-1 items-center justify-center overflow-hidden">
        <div
          className="wf-wheel"
          onMouseLeave={() => setHovered(null)}
        >
          <svg className="wf-wheel-svg" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet">
            <circle className="ring" cx={CX} cy={CY} r={RO} />
            <g className="inner-arcs">
              {ENGINE_MODULES.map((m, i) => (
                <path
                  key={`arc-${m.key}`}
                  d={innerArc(i)}
                  className={`inner-arc${i === activeIndex ? ' active' : ''}`}
                />
              ))}
            </g>
            <g className="dividers">
              {ENGINE_MODULES.map((m, i) => {
                const l = dividerLine(i);
                return <line key={`div-${m.key}`} className="divider" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />;
              })}
            </g>
            <g className="wedges">
              {ENGINE_MODULES.map((m, i) => (
                <path
                  key={`wedge-${m.key}`}
                  d={wedgePath(i)}
                  className={`wedge${i === activeIndex ? ' active' : ''}`}
                  onMouseEnter={() => setHovered(i)}
                  onClick={() => setPinned((prev) => (prev === i ? null : i))}
                />
              ))}
            </g>
            <g className="wedge-outlines">
              {ENGINE_MODULES.map((m, i) => (
                <path
                  key={`outline-${m.key}`}
                  d={wedgePath(i)}
                  className={`wedge-outline${i === activeIndex ? ' active' : ''}`}
                />
              ))}
            </g>
          </svg>

          <div className="wf-wheel-items">
            {ENGINE_MODULES.map((m, i) => (
              <div
                key={`item-${m.key}`}
                className={`wf-wheel-item${i === activeIndex ? ' active' : ''}`}
                style={itemPosition(i)}
              >
                <div className="wf-wheel-item-id">{m.id}</div>
                <div className="wf-wheel-item-tag">{m.tag}</div>
              </div>
            ))}
          </div>

          <div className="wf-wheel-center">
            <div className="wf-wheel-stage">{active ? active.stage : 'ENGINE ACTIVITY'}</div>
            <div className="wf-wheel-name">{active ? active.name : 'ALL MODULES'}</div>
            <div className="wf-wheel-desc">
              {active
                ? active.desc
                : `Most recent runs across all ${N} modules — hover a module to filter.`}
            </div>
            <div className="wf-wheel-meta">
              {active ? (
                <>
                  <span>{active.tag}</span>
                  <span>{active.status}</span>
                </>
              ) : (
                <>
                  <span>{N} MODULES</span>
                  <span>LIVE</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </GrowthCard>
  );
}

// Ported from the design mock's `.wf-wheel-*` rules, with the light-theme tokens
// resolved to the repo's hardcoded growth hexes (--hi #15171c, --ink #fff,
// --line-2 #d6dade, --panel #fff, --txt #15171c, --txt-2 #5b626d, --txt-3 #959ca7).
const WHEEL_CSS = `
.wf-wheel{position:relative;width:100%;max-width:440px;aspect-ratio:1;max-height:100%;margin:auto}
.wf-wheel-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.wf-wheel-svg .ring{fill:none;stroke:#d6dade;stroke-width:1;vector-effect:non-scaling-stroke}
.wf-wheel-svg .divider{stroke:#d6dade;stroke-width:1;vector-effect:non-scaling-stroke}
.wf-wheel-svg .inner-arc{fill:none;stroke:#d6dade;stroke-width:1;vector-effect:non-scaling-stroke;transition:opacity .25s ease}
.wf-wheel-svg .inner-arc.active{opacity:0}
.wf-wheel-svg .wedge{fill:rgba(0,0,0,0);cursor:pointer;pointer-events:all;transform-origin:300px 300px;transform-box:view-box;transition:fill .35s cubic-bezier(.4,0,.2,1),transform .35s cubic-bezier(.34,1.56,.64,1)}
.wf-wheel-svg .wedge:hover,.wf-wheel-svg .wedge.active{fill:#15171c;transform:scale(1.06)}
.wf-wheel-svg .wedge-outline{fill:none;stroke:#15171c;stroke-width:0;pointer-events:none;transform-origin:300px 300px;transform-box:view-box;transition:stroke-width .35s ease,transform .35s cubic-bezier(.34,1.56,.64,1)}
.wf-wheel-svg .wedge-outline.active{stroke-width:1.5;transform:scale(1.06)}
.wf-wheel-items{position:absolute;inset:0;pointer-events:none}
.wf-wheel-item{position:absolute;transform:translate(-50%,-50%);text-align:center;pointer-events:none;transition:transform .3s ease}
.wf-wheel-item-id{font-size:12px;color:#959ca7;font-weight:700;letter-spacing:.04em;line-height:1;transition:color .3s ease,transform .3s ease}
.wf-wheel-item-tag{font-size:8px;color:#959ca7;letter-spacing:.14em;margin-top:3px;font-weight:700}
.wf-wheel-item.active .wf-wheel-item-id{color:#fff;transform:scale(1.15)}
.wf-wheel-item.active .wf-wheel-item-tag{color:#fff}
.wf-wheel-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:47%;height:47%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:14px;background:#fff;border-radius:50%}
.wf-wheel-stage{font-size:9px;color:#959ca7;letter-spacing:.2em;font-weight:700;margin-bottom:6px}
.wf-wheel-name{font-size:clamp(13px,1.6vw,17px);font-weight:800;color:#15171c;line-height:1.1;letter-spacing:-.01em;margin-bottom:8px;text-transform:uppercase}
.wf-wheel-desc{font-size:10.5px;color:#959ca7;line-height:1.45;margin-bottom:10px;max-width:100%}
.wf-wheel-meta{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}
.wf-wheel-meta span{font-size:8.5px;color:#5b626d;border:1px solid #d6dade;padding:2px 7px;letter-spacing:.1em;font-weight:700;border-radius:4px}
`;
