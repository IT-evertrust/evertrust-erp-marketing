import {
  SOURCE_WEIGHT,
  computeLinePricing,
  computeTenderRisk,
} from '@evertrust/shared';

// The pricing engine is PURE/DETERMINISTIC — these tests pin every rule from the
// Phase 5a spec so a weight tweak or signal/confidence regression is caught here
// (the same functions run in the API and the web UI).

describe('computeLinePricing — empty', () => {
  // WHY: no evidence must be an explicit RED/ESTIMATE_ONLY zero, not a guess.
  it('returns null price, 0 confidence, ESTIMATE_ONLY/RED, not backed', () => {
    expect(computeLinePricing([])).toEqual({
      suggestedPrice: null,
      confidence: 0,
      signal: 'ESTIMATE_ONLY',
      ryg: 'RED',
      backed: false,
    });
  });
});

describe('computeLinePricing — source weighting picks the price', () => {
  // WHY: a single real SUPPLIER_QUOTE (90) must dominate an AI_ESTIMATE (40).
  it('uses the highest-SOURCE_WEIGHT observation as the suggested price', () => {
    const r = computeLinePricing([
      { source: 'AI_ESTIMATE', price: 40 },
      { source: 'SUPPLIER_QUOTE', price: 90 },
    ]);
    expect(r.suggestedPrice).toBe(90);
    expect(r.signal).toBe('REAL_QUOTES');
    expect(r.ryg).toBe('GREEN');
    expect(r.backed).toBe(true);
  });

  it('keeps the FIRST of equal-weight ties (inputs are newest-first)', () => {
    // Two MANUAL (weight 50) observations: the first/newest wins.
    const r = computeLinePricing([
      { source: 'MANUAL', price: 111 },
      { source: 'MANUAL', price: 222 },
    ]);
    expect(r.suggestedPrice).toBe(111);
  });

  it('SOURCE_WEIGHT ordering matches the spec', () => {
    expect(SOURCE_WEIGHT).toEqual({
      SUPPLIER_QUOTE: 90,
      OUR_SUBMITTED: 80,
      COMPETITOR_WINNER: 70,
      IBAU_HISTORICAL: 60,
      MANUAL: 50,
      OUR_BENCHMARK: 45,
      AI_ESTIMATE: 40,
    });
  });
});

describe('computeLinePricing — signal classification', () => {
  // WHY: REAL_QUOTES requires a SUPPLIER_QUOTE specifically; other real sources
  // without a supplier quote are MIXED, and all-estimate is ESTIMATE_ONLY.
  it('REAL_QUOTES when any SUPPLIER_QUOTE is present', () => {
    expect(
      computeLinePricing([{ source: 'SUPPLIER_QUOTE', price: 10 }]).signal,
    ).toBe('REAL_QUOTES');
  });

  it('ESTIMATE_ONLY when every observation is an estimate source', () => {
    const r = computeLinePricing([
      { source: 'AI_ESTIMATE', price: 10 },
      { source: 'OUR_BENCHMARK', price: 12 },
    ]);
    expect(r.signal).toBe('ESTIMATE_ONLY');
    expect(r.ryg).toBe('RED');
    expect(r.backed).toBe(false);
  });

  it('MIXED when real (non-quote) + estimate but no SUPPLIER_QUOTE', () => {
    const r = computeLinePricing([
      { source: 'OUR_SUBMITTED', price: 80 },
      { source: 'AI_ESTIMATE', price: 40 },
    ]);
    expect(r.signal).toBe('MIXED');
    expect(r.ryg).toBe('YELLOW');
    expect(r.backed).toBe(true);
  });
});

describe('computeLinePricing — confidence', () => {
  // WHY: confidence = min(bestWeight + min(15, 5*(n-1)), 95).
  it('adds 5 per extra observation, capped at +15', () => {
    // 1 quote: 90 + 0 = 90
    expect(
      computeLinePricing([{ source: 'SUPPLIER_QUOTE', price: 1 }]).confidence,
    ).toBe(90);
    // 2 quotes: 90 + 5 = 95 (then global cap 95)
    expect(
      computeLinePricing([
        { source: 'SUPPLIER_QUOTE', price: 1 },
        { source: 'SUPPLIER_QUOTE', price: 1 },
      ]).confidence,
    ).toBe(95);
    // 5 quotes: 90 + min(15, 20) = 105 -> capped to 95
    expect(
      computeLinePricing(
        Array.from({ length: 5 }, () => ({
          source: 'SUPPLIER_QUOTE' as const,
          price: 1,
        })),
      ).confidence,
    ).toBe(95);
  });

  it('caps ESTIMATE_ONLY confidence at 60', () => {
    // 4 AI estimates: best 40 + min(15, 15)=15 = 55 (under 60) -> 55
    expect(
      computeLinePricing(
        Array.from({ length: 4 }, () => ({
          source: 'AI_ESTIMATE' as const,
          price: 1,
        })),
      ).confidence,
    ).toBe(55);
    // 5 MANUAL-as-estimate? MANUAL is REAL. Use OUR_BENCHMARK (45, estimate):
    // 45 + 15 = 60 exactly.
    expect(
      computeLinePricing(
        Array.from({ length: 4 }, () => ({
          source: 'OUR_BENCHMARK' as const,
          price: 1,
        })),
      ).confidence,
    ).toBe(60);
    // Force above 60 then confirm the cap: many OUR_BENCHMARK -> 45+15=60 cap.
    expect(
      computeLinePricing(
        Array.from({ length: 10 }, () => ({
          source: 'OUR_BENCHMARK' as const,
          price: 1,
        })),
      ).confidence,
    ).toBe(60);
  });

  it('rounds confidence to an integer', () => {
    const r = computeLinePricing([{ source: 'MANUAL', price: 1 }]);
    expect(Number.isInteger(r.confidence)).toBe(true);
    expect(r.confidence).toBe(50);
  });
});

describe('computeTenderRisk', () => {
  // WHY: high risk if >=35% of lines unbacked OR any top-5 (by bidGp) is unbacked.
  it('no lines -> not high risk', () => {
    expect(computeTenderRisk([])).toEqual({
      highRisk: false,
      unbackedRatio: 0,
      reasons: [],
    });
  });

  it('flags high risk at the 35% unbacked threshold', () => {
    // 10 lines, all small bidGp; 4 unbacked = 40% >= 35%. Keep the 4 unbacked OUT
    // of the top-5 by giving backed lines the larger bidGp, to isolate the ratio
    // rule from the top-5 rule.
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => ({ bidGp: 100 + i, backed: true })),
      ...Array.from({ length: 4 }, () => ({ bidGp: 1, backed: false })),
    ];
    const r = computeTenderRisk(lines);
    expect(r.highRisk).toBe(true);
    expect(r.unbackedRatio).toBeCloseTo(0.4, 5);
    expect(r.reasons.some((x) => x.includes('estimate-only'))).toBe(true);
  });

  it('does NOT flag below 35% when no top-5 line is unbacked', () => {
    // 10 lines, 3 unbacked = 30% < 35%, and the unbacked ones are the smallest.
    const lines = [
      ...Array.from({ length: 7 }, (_, i) => ({ bidGp: 100 + i, backed: true })),
      ...Array.from({ length: 3 }, () => ({ bidGp: 1, backed: false })),
    ];
    const r = computeTenderRisk(lines);
    expect(r.highRisk).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('flags high risk when a top-5 line by bidGp is unbacked (even under 35%)', () => {
    // 20 lines, only 1 unbacked = 5% (well under 35%), BUT it is the biggest line
    // by bidGp -> top-5 rule fires.
    const lines = [
      { bidGp: 100000, backed: false }, // biggest, unbacked
      ...Array.from({ length: 19 }, (_, i) => ({ bidGp: 10 + i, backed: true })),
    ];
    const r = computeTenderRisk(lines);
    expect(r.highRisk).toBe(true);
    expect(r.unbackedRatio).toBeCloseTo(0.05, 5);
    expect(r.reasons.some((x) => x.includes('top-5'))).toBe(true);
  });

  it('treats null bidGp as 0 weight in the top-5 ranking', () => {
    // The single unbacked line has null bidGp; five backed lines have real money,
    // so the unbacked line is NOT in the top-5 and (1/6 < 35%) is not high risk.
    const lines = [
      { bidGp: null, backed: false },
      ...Array.from({ length: 5 }, (_, i) => ({
        bidGp: 1000 + i,
        backed: true,
      })),
    ];
    const r = computeTenderRisk(lines);
    expect(r.highRisk).toBe(false);
  });
});
