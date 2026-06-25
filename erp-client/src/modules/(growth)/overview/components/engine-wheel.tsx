'use client';

// "Engine Modules" wheel — a faithful port of the Saloot demo's SVG donut. Nine
// wedges (one per engine module) around a central info panel; hovering a wedge
// fills it, surfaces that module's description in the centre, and (via the parent)
// filters the live Engine Activity feed to that module. Geometry mirrors the HTML
// exactly: viewBox 600×600, outer radius 290, inner radius 150, 40° segments.
import { useEffect, useRef, useState } from 'react';

import { ENGINE_MODULES } from '../engine-modules';

const N = ENGINE_MODULES.length; // 9
const CX = 300;
const CY = 300;
const RO = 290; // outer radius
const RI = 150; // inner radius
const SEG = 360 / N; // 40°
const RIP = 35; // item-label radius, as a % of the wheel box

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function point(r: number, angleDeg: number): [number, number] {
  const a = rad(angleDeg);
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function wedgePath(i: number): string {
  const a1 = i * SEG - 90 - SEG / 2;
  const a2 = i * SEG - 90 + SEG / 2;
  const [x1o, y1o] = point(RO, a1);
  const [x2o, y2o] = point(RO, a2);
  const [x1i, y1i] = point(RI, a1);
  const [x2i, y2i] = point(RI, a2);
  return `M ${x1i} ${y1i} L ${x1o} ${y1o} A ${RO} ${RO} 0 0 1 ${x2o} ${y2o} L ${x2i} ${y2i} A ${RI} ${RI} 0 0 0 ${x1i} ${y1i} Z`;
}

function dividerLine(i: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = i * SEG - 90 + SEG / 2;
  const [x1, y1] = point(RI, a);
  const [x2, y2] = point(RO, a);
  return { x1, y1, x2, y2 };
}

function innerArc(i: number): string {
  const a1 = i * SEG - 90 - SEG / 2;
  const a2 = i * SEG - 90 + SEG / 2;
  const [ax1, ay1] = point(RI, a1);
  const [ax2, ay2] = point(RI, a2);
  return `M ${ax1} ${ay1} A ${RI} ${RI} 0 0 1 ${ax2} ${ay2}`;
}

function itemPos(i: number): { left: number; top: number } {
  const a = rad(i * SEG - 90);
  return { left: 50 + RIP * Math.cos(a), top: 50 + RIP * Math.sin(a) };
}

const WHEEL = ENGINE_MODULES.map((m, i) => ({
  module: m,
  d: wedgePath(i),
  divider: dividerLine(i),
  arc: innerArc(i),
  item: itemPos(i),
}));

export function EngineWheel({
  onActiveChange,
}: {
  onActiveChange?: (moduleKey: string | null) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);

  const activeIdx = hoverIdx ?? pinnedIdx;
  const active = activeIdx != null ? ENGINE_MODULES[activeIdx] : null;
  const activeKey = active?.key ?? null;

  // Push the active module up to the parent (which filters the feed) without
  // re-subscribing every render — the callback lives in a ref.
  const cbRef = useRef(onActiveChange);
  cbRef.current = onActiveChange;
  useEffect(() => {
    cbRef.current?.(activeKey);
  }, [activeKey]);

  return (
    <div className="flex min-w-0 flex-col rounded-[10px] border border-[#e4e7eb] bg-white">
      <div className="flex items-center justify-between border-b border-[#e4e7eb] px-4 py-[15px]">
        <h3 className="text-[13.5px] font-bold text-[#15171c]">Engine Modules</h3>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        <div
          className="relative mx-auto aspect-square w-full max-w-[440px]"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <svg
            viewBox="0 0 600 600"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <circle
              cx={CX}
              cy={CY}
              r={RO}
              fill="none"
              stroke="#d6dade"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />

            {/* dividers */}
            {WHEEL.map(({ divider }, i) => (
              <line
                key={`div-${i}`}
                x1={divider.x1}
                y1={divider.y1}
                x2={divider.x2}
                y2={divider.y2}
                stroke="#d6dade"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* inner arcs (hidden while their wedge is active) */}
            {WHEEL.map(({ arc }, i) => (
              <path
                key={`arc-${i}`}
                d={arc}
                fill="none"
                stroke="#d6dade"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={{
                  opacity: activeIdx === i ? 0 : 1,
                  transition: 'opacity .25s ease',
                }}
              />
            ))}

            {/* wedges */}
            {WHEEL.map(({ d }, i) => {
              const isActive = activeIdx === i;
              return (
                <path
                  key={`wedge-${i}`}
                  d={d}
                  onMouseEnter={() => setHoverIdx(i)}
                  onClick={() => setPinnedIdx((p) => (p === i ? null : i))}
                  style={{
                    fill: isActive ? '#15171c' : 'rgba(0,0,0,0)',
                    cursor: 'pointer',
                    pointerEvents: 'all',
                    transformBox: 'view-box',
                    transformOrigin: '300px 300px',
                    transform: isActive ? 'scale(1.06)' : 'none',
                    transition:
                      'fill .35s cubic-bezier(.4,0,.2,1), transform .35s cubic-bezier(.34,1.56,.64,1)',
                  }}
                />
              );
            })}

            {/* active wedge outline */}
            {WHEEL.map(({ d }, i) => {
              const isActive = activeIdx === i;
              return (
                <path
                  key={`outline-${i}`}
                  d={d}
                  fill="none"
                  stroke="#15171c"
                  style={{
                    strokeWidth: isActive ? 1.5 : 0,
                    pointerEvents: 'none',
                    transformBox: 'view-box',
                    transformOrigin: '300px 300px',
                    transform: isActive ? 'scale(1.06)' : 'none',
                    transition:
                      'stroke-width .35s ease, transform .35s cubic-bezier(.34,1.56,.64,1)',
                  }}
                />
              );
            })}
          </svg>

          {/* module id + tag labels */}
          <div className="pointer-events-none absolute inset-0">
            {WHEEL.map(({ module, item }, i) => {
              const isActive = activeIdx === i;
              return (
                <div
                  key={`item-${i}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                  style={{ left: `${item.left}%`, top: `${item.top}%` }}
                >
                  <div
                    className="text-[12px] font-bold leading-none tracking-[0.04em]"
                    style={{
                      color: isActive ? '#ffffff' : '#959ca7',
                      transform: isActive ? 'scale(1.15)' : 'none',
                      transition: 'color .3s ease, transform .3s ease',
                    }}
                  >
                    {module.id}
                  </div>
                  <div
                    className="mt-[3px] text-[8px] font-bold tracking-[0.14em]"
                    style={{ color: isActive ? '#ffffff' : '#959ca7', transition: 'color .3s ease' }}
                  >
                    {module.tag}
                  </div>
                </div>
              );
            })}
          </div>

          {/* centre info panel */}
          <div className="absolute left-1/2 top-1/2 flex h-[47%] w-[47%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-white p-[14px] text-center">
            <div className="mb-[6px] text-[9px] font-bold tracking-[0.2em] text-[#959ca7]">
              {active ? active.stage : 'ENGINE ACTIVITY'}
            </div>
            <div className="mb-2 text-[clamp(13px,1.6vw,17px)] font-extrabold uppercase leading-[1.1] tracking-[-0.01em] text-[#15171c]">
              {active ? active.name : 'ALL MODULES'}
            </div>
            <div className="mb-[10px] max-w-full text-[10.5px] leading-[1.45] text-[#959ca7]">
              {active
                ? active.desc
                : 'Most recent runs across all 9 modules — hover a module to filter.'}
            </div>
            <div className="flex flex-wrap justify-center gap-[6px]">
              {(active ? [active.tag, active.status] : ['9 MODULES', 'LIVE']).map((label) => (
                <span
                  key={label}
                  className="rounded-[4px] border border-[#d6dade] px-[7px] py-[2px] text-[8.5px] font-bold tracking-[0.1em] text-[#5b626d]"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
