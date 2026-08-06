import type { Ctx } from '../App';
import { C, FONT, LINE, num } from '../theme';
import { Callout, Prose, SectionHead, Source, StatGrid } from '../components/primitives';
import { useArtwork, useCost, type CostRow } from '../lib/api';

/**
 * What this system costs to run, and specifically what the AI costs.
 *
 * Two independent estimates per model, side by side, for the same reason the
 * entitlement panel shows local and RevenueCat together: AI Gateway's own `cost`
 * is documented as "best-effort estimation - refer to your provider's dashboard
 * for exact billing amounts". One estimate is a number you have to trust. Two
 * that agree is evidence; two that disagree is a finding.
 *
 * Ours is priced from published per-token rates at the UNCACHED input rate, so
 * it reads as an upper bound. Where the gateway comes in lower, prompt caching
 * is the usual explanation and the gap is roughly the cache hit rate.
 */
export default function Cost({ ctx }: { ctx: Ctx }) {
  const hours = Math.max(ctx.hours, 24);
  const cost = useCost(hours, !ctx.demo);
  const artwork = useArtwork(Math.max(Math.round(hours / 24), 1), !ctx.demo);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Callout tone="teal" icon>
        Two estimates per model, never one. AI Gateway's cost is its own best-effort figure; ours is computed from the
        provider's published per-token rate. Agreement is evidence, and a gap is usually prompt caching - our number
        prices every input token at the uncached rate, so it reads high on purpose.
      </Callout>

      <Source data={cost} what="AI spend">
        {(d) => {
          const reported = d.models.reduce((a, m) => a + m.reported, 0);
          const computed = d.models.reduce((a, m) => a + (m.computed ?? 0), 0);
          const tokens = d.models.reduce((a, m) => a + m.tokensIn + m.tokensOut, 0);
          const requests = d.models.reduce((a, m) => a + m.requests, 0);
          const unpriced = d.models.filter((m) => m.unpriced);
          const perDay = (reported / d.hours) * 24;

          return (
            <>
              <StatGrid
                min={190}
                items={[
                  {
                    label: 'Gateway cost',
                    value: money(reported),
                    context: `over ${d.hours}h · ${requests.toLocaleString()} requests`,
                    tone: 'plain'
                  },
                  {
                    label: 'Computed cost',
                    value: money(computed),
                    context: 'from published rates, uncached',
                    tone: 'plain'
                  },
                  {
                    label: 'Tokens',
                    value: compact(tokens),
                    context: 'in + out',
                    tone: 'plain'
                  },
                  {
                    // A daily figure is what tells you whether the $5/day gateway
                    // limit is a backstop or a ceiling you are about to hit.
                    label: 'Run rate',
                    value: `${money(perDay)}/day`,
                    context: `≈ ${money(perDay * 30)}/month at this rate`,
                    tone: perDay > 4 ? 'bad' : perDay > 1 ? 'warn' : 'plain'
                  }
                ]}
              />

              {/*
                The most important statement on this page. A per-image model is
                priced per image, the gateway prices per token, so it reports zero
                however many calls were made. Totalling that column and calling it
                "spend" understates by an unknown amount - and image generation is
                expensive enough to be the largest line while reading as free.
              */}
              {/*
                The image spend the gateway cannot see, now countable.
                
                My handover called this "plausibly the largest line". It is not -
                the backend measured it at roughly a quarter of the text spend,
                because quality:'low' was already chosen at the call site. I had
                inferred a price from the model name without checking the options,
                and stated it too strongly. The scaling concern was right; the
                magnitude was not.
              */}
              {artwork.state === 'ok' && (
                <div
                  style={{
                    border: LINE.edge,
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: 8,
                    padding: '15px 17px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 14,
                    alignItems: 'baseline'
                  }}
                >
                  <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <div
                      style={{
                        font: `600 9.5px/1 ${FONT.text}`,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: C.t3,
                        marginBottom: 8
                      }}
                    >
                      Station artwork · measured by the backend
                    </div>
                    <div style={{ font: `400 12px/1.6 ${FONT.text}`, color: C.t2, maxWidth: '72ch' }}>
                      {artwork.data.images === 0
                        ? 'No generations recorded in this window. The event was added today, so an empty result here means not yet observed - it is not evidence that nothing was generated.'
                        : 'Counted from the backend\u2019s own estimate rather than the gateway, which prices per token and reports images as $0. One image per station created, so this scales with signups.'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ ...num, font: `500 19px/1 ${FONT.mono}`, color: artwork.data.images ? C.t1 : C.t3 }}>
                      {artwork.data.images === 0 ? 'none yet' : money(artwork.data.cost)}
                    </div>
                    <div style={{ font: `400 10px/1.5 ${FONT.text}`, color: C.t3, marginTop: 5 }}>
                      {artwork.data.images.toLocaleString()} image{artwork.data.images === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              )}

              {unpriced.length > 0 && (
                <div
                  style={{
                    border: '1px solid rgba(224,160,48,0.28)',
                    background: 'rgba(224,160,48,0.06)',
                    borderRadius: 8,
                    padding: '15px 17px'
                  }}
                >
                  <div
                    style={{
                      font: `600 10px/1 ${FONT.text}`,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: C.warnText,
                      marginBottom: 8
                    }}
                  >
                    Totals above exclude {unpriced.length} model{unpriced.length === 1 ? '' : 's'}
                  </div>
                  <div style={{ font: `400 12.5px/1.6 ${FONT.text}`, color: C.t2, maxWidth: '80ch' }}>
                    {unpriced.map((m) => m.model).join(', ')}{' '}
                    {unpriced.length === 1 ? 'is billed' : 'are billed'} per image, not per token, so the gateway
                    reports <strong style={{ fontWeight: 500, color: '#fff' }}>$0.00</strong> however many calls are
                    made. That is not free, it is <strong style={{ fontWeight: 500, color: '#fff' }}>not counted</strong>
                    . {unpriced.reduce((a, m) => a + m.requests, 0)} call
                    {unpriced.reduce((a, m) => a + m.requests, 0) === 1 ? '' : 's'} in this window are missing from
                    every figure on this page, and image generation is expensive enough to be the largest line while
                    reading as nothing.
                  </div>
                </div>
              )}

              <section>
                <SectionHead title="By model" meta="aiGatewayRequestsAdaptiveGroups" />
                <Head />
                {d.models.map((m) => (
                  <Row key={`${m.gateway}-${m.model}`} m={m} />
                ))}
                <div style={{ paddingTop: 14 }}>
                  <Prose>
                    Rates are transcribed from each provider's own documentation and verified 6 Aug 2026. Like the
                    scoring weights, they are <strong style={{ fontWeight: 500, color: C.warnText }}>not read live</strong>{' '}
                    - a provider can change a price and nothing here will notice. A model with no rate shows its
                    computed column as unpriced rather than as zero.
                  </Prose>
                </div>
              </section>
            </>
          );
        }}
      </Source>
    </div>
  );
}

const cols = [
  { label: 'Model', w: undefined as number | undefined },
  { label: 'Calls', w: 64 },
  { label: 'Tokens in', w: 88 },
  { label: 'Tokens out', w: 88 },
  { label: 'Gateway', w: 84 },
  { label: 'Computed', w: 84 },
  { label: 'Gap', w: 64 }
];

const Head = () => (
  <div
    style={{
      display: 'flex',
      gap: 12,
      padding: '10px 0',
      borderBottom: LINE.row,
      font: `600 9.5px/1 ${FONT.text}`,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: C.t3
    }}
  >
    {cols.map((c) => (
      <span key={c.label} style={c.w ? { width: c.w, textAlign: 'right', flex: 'none' } : { flex: 1, minWidth: 0 }}>
        {c.label}
      </span>
    ))}
  </div>
);

function Row({ m }: { m: CostRow }) {
  /**
   * A percentage gap needs both a rate and enough volume to divide by.
   *
   * The embeddings row reported 0 tokens and $0.00000022, which produced a
   * -100% gap in amber - a warning about nothing, on a row costing two
   * ten-millionths of a cent. A cost dashboard that cries wolf on rounding
   * error gets its real warnings ignored, which is the failure this product
   * spends most of its effort avoiding.
   */
  const gap =
    m.computed != null && m.reported > 0.0001 && m.tokensIn + m.tokensOut > 0
      ? ((m.computed - m.reported) / m.reported) * 100
      : null;

  return (
    <div style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            font: `400 12.5px/1.4 ${FONT.mono}`,
            color: 'rgba(255,255,255,0.85)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {m.model}
        </span>
        <span style={{ display: 'block', font: `400 11px/1.5 ${FONT.text}`, color: C.t3, marginTop: 2 }}>
          {m.provider} · {m.gateway}
          {m.rateSource ? ` · rate from ${m.rateSource}` : ' · no published rate on file'}
        </span>
      </span>
      <Cell w={64} v={m.requests.toLocaleString()} />
      <Cell w={88} v={compact(m.tokensIn)} />
      <Cell w={88} v={compact(m.tokensOut)} />
      <Cell w={84} v={m.unpriced ? 'not priced' : money(m.reported)} color={m.unpriced ? C.warnText : C.t1} />
      <Cell
        w={84}
        v={m.computed == null ? (m.perImage ? 'per image' : 'unpriced') : money(m.computed)}
        color={m.computed == null ? C.t3 : C.t1}
      />
      <Cell
        w={64}
        v={gap == null ? '-' : `${gap > 0 ? '+' : ''}${gap.toFixed(0)}%`}
        // A gap beyond 25% is worth a look: either the rate table is stale or the
        // gateway is pricing something we are not modelling.
        color={gap == null ? C.t3 : Math.abs(gap) > 25 ? C.warnText : C.t2}
      />
    </div>
  );
}

const Cell = ({ w, v, color = C.t2 }: { w: number; v: string; color?: string }) => (
  <span style={{ ...num, width: w, flex: 'none', textAlign: 'right', font: `400 12.5px/1.2 ${FONT.mono}`, color }}>
    {v}
  </span>
);

/** Sub-cent figures are the normal case here, so never round them to $0.00. */
const money = (n: number) => (n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
