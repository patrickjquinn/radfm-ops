import type { Ctx } from '../App';
import { C, FONT, LINE, num, GAP } from '../theme';
import { Callout, Prose, SectionHead, Source, StatGrid, Panel, SkelStats } from '../components/primitives';
import { useArtwork, useCost, type CostRow } from '../lib/api';
import { STATE } from '../lib/vocabulary';

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
    <div style={{ display: 'grid', gap: GAP }}>
      <Callout tone="teal" icon>
        Two estimates per model, never one. The gateway's is best-effort; ours uses the provider's published
        per-token rate. A gap is usually prompt caching - ours prices every input token uncached, so it reads high.
      </Callout>

      <Source data={cost} what="AI spend" skeleton={<SkelStats n={4} min={190} />}>
        {(d) => {
          const reported = d.models.reduce((a, m) => a + m.reported, 0);
          const computed = d.models.reduce((a, m) => a + (m.computed ?? 0), 0);
          const tokens = d.models.reduce((a, m) => a + m.tokensIn + m.tokensOut, 0);
          const requests = d.models.reduce((a, m) => a + m.requests, 0);
          const unpriced = d.models.filter((m) => m.unpriced);
          const unpricedCalls = unpriced.reduce((a, m) => a + m.requests, 0);
          const perDay = (reported / d.hours) * 24;
          /*
            The gateway counted image calls and the backend's own artwork event
            counted none, in the same window, on the same screen. The page said
            "none yet" directly above a block saying 499 calls were made - two
            counts of the same thing disagreeing, which is the failure this
            product exists to catch, reproduced by the product.

            Neither number is deleted. The disagreement is stated, because it is
            the actual finding: the event shipped on 6 Aug and most of those
            calls predate it, so "none yet" is true of the event and false of
            the world.
          */
          const artworkContradiction =
            artwork.state === 'ok' && artwork.data.images === 0 && unpricedCalls > 0;

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
                A per-image model is priced per image, the gateway prices per
                token, so it reports zero however many calls were made. Totalling
                that column as "spend" understates by an unknown amount.
                
                The copy here previously called it "expensive enough to be the
                largest line". That was my inference from the model name, and it
                was wrong - the backend measured quality:'low' at $0.011/image,
                about a quarter of the text spend. Corrected rather than quietly
                deleted, because a cost claim is exactly where a guess should not
                have been stated as a magnitude.
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
                      {artworkContradiction ? (
                        <>
                          <strong style={{ fontWeight: 500, color: C.warnText }}>
                            These two panels disagree.
                          </strong>{' '}
                          The gateway counted {unpricedCalls.toLocaleString()} image call
                          {unpricedCalls === 1 ? '' : 's'} in this window and the backend&rsquo;s own artwork event
                          recorded none. The event shipped on 6 Aug, so most of those calls happened before anything
                          was watching. Read this as <em>not measured</em>, never as zero spend - and if it is still
                          reading none once the window is entirely after 6 Aug, the event is not firing.
                        </>
                      ) : artwork.data.images === 0 ? (
                        'No generations recorded in this window, and the gateway saw no image calls either. The two agree, so this is absence rather than a gap in instrumentation.'
                      ) : (
                        'Counted from the backend\u2019s own estimate rather than the gateway, which prices per token and reports images as $0. One image per station created, so this scales with signups.'
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        ...num,
                        font: `500 19px/1 ${FONT.mono}`,
                        color: artworkContradiction ? C.warnText : artwork.data.images ? C.t1 : C.t3
                      }}
                    >
                      {/*
                        "none yet" claims we are recording and nothing happened.
                        When the gateway says otherwise, that claim is false and
                        the honest word is the one for "we could not measure it".
                      */}
                      {artwork.data.images === 0
                        ? artworkContradiction
                          ? STATE.notRecorded
                          : STATE.noneYet
                        : money(artwork.data.cost)}
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
                    every figure on this page and from the gateway's spend limit.{' '}
                    {artworkContradiction
                      ? 'The backend measures it separately, but its artwork event has not recorded these calls - see the panel above. The magnitude for this window is genuinely unknown; the backend measured a comparable period at roughly a quarter of the text spend.'
                      : 'The backend measures it separately - see the artwork panel above - and put it at roughly a quarter of the text spend, not more.'}{' '}
                    It scales with signups, which is why it is worth counting, not because it is large today.
                  </div>
                </div>
              )}

              <Panel title="By model" meta="aiGatewayRequestsAdaptiveGroups">
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
              </Panel>
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
        v={m.computed == null ? 'not priced' : money(m.computed)}
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
