import { useState } from 'react';
import type { Ctx } from '../App';
import { C, CARD, FONT, LINE, MOTION, GAP, focusLift, num } from '../theme';
import { Icon } from '../icons';
import { Bar, Callout, Panel, Prose, Skel, SkelRows, Source, StatGrid } from '../components/primitives';
import {
  artworkUrl,
  useCreatePromotion,
  usePromotionSearch,
  usePromotions,
  useRetirePromotion,
  type Promotion,
  type PromoSearchResult
} from '../lib/api';

/**
 * Promoted music - the first surface in this dashboard that changes what a
 * listener hears.
 *
 * An operator picks a song or an artist and it enters the same candidate pool
 * everything else competes in. It competes: it is not given a guaranteed slot,
 * and it cannot beat a dislike, a station blacklist or an era brief at any
 * weight. That is the difference between "they played me something new" and
 * "they ignored me", and it is enforced in the recommendation path, not here.
 *
 * Every call is gated on `can.operate`. The backend answers a viewer with a bare
 * 404 that is indistinguishable from the rate limiter, so a viewer who reached
 * these would see "source could not be read" and go hunting an outage that is
 * really a permission.
 */
export default function Promoted({ ctx }: { ctx: Ctx }) {
  const operator = ctx.can.operate;
  const [kind, setKind] = useState<'song' | 'artist'>('song');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [includeRetired, setIncludeRetired] = useState(false);

  const search = usePromotionSearch(q, kind, operator);
  const list = usePromotions(includeRetired, operator);
  const create = useCreatePromotion();
  const retire = useRetirePromotion();

  if (!operator) return <NotOperator />;

  const results = search.state === 'ok' ? (kind === 'song' ? search.data.songs : search.data.artists) : [];
  const promos = list.state === 'ok' ? list.data.promotions : [];
  const active = promos.filter((p) => p.active);
  /*
    Already-promoted ids, so a result that would 409 says so instead of offering
    a button that cannot work. The API's refusal is correct and the error copy
    handles it, but an operator should not have to trigger an error to discover
    a fact the page already has on screen.
  */
  const promotedIds = new Set(active.map((p) => p.appleId));

  return (
    <div style={{ display: 'grid', gap: GAP }}>
      <Callout tone="teal" icon>
        A promotion <strong style={{ fontWeight: 500, color: '#fff' }}>competes</strong>, it is not a guaranteed slot -
        it enters the same candidate pool as everything else and can lose on merit. It will never override a dislike at
        any weight, never appear in a station whose brief excludes it, and is capped per listener per day. Targeting
        fires on the genres a pool actually came back with, not on anything declared up front.
      </Callout>

      {/*
        The campaign at a glance. Reach leads because it is the question the rest
        of the page cannot answer from a single row: a promotion can look busy
        and touch almost nobody.
      */}
      {list.state === 'ok' && active.length > 0 && (
        <StatGrid
          min={190}
          items={[
            {
              label: 'Active',
              value: String(active.length),
              context: `${promos.length - active.length} retired`,
              tone: 'plain'
            },
            {
              label: 'Served',
              value: active.reduce((a, p) => a + p.served, 0).toLocaleString(),
              context: 'impressions, all campaigns',
              tone: 'plain'
            },
            {
              label: 'Listeners reached',
              value: active.reduce((a, p) => a + p.listeners, 0).toLocaleString(),
              // Deliberately not deduplicated across promotions: one person
              // reached by two campaigns is two rows in the impression table and
              // we cannot tell from here that it is the same person.
              context: 'summed per promotion, not unique people',
              tone: 'plain'
            },
            {
              label: 'On genre alone',
              value: String(active.filter((p) => p.featureSource === 'genre').length),
              context: 'sequencing is approximate',
              tone: active.some((p) => p.featureSource === 'genre') ? 'warn' : 'plain'
            }
          ]}
        />
      )}

      {/* ── Find something to promote ─────────────────────────────────────── */}
      <Panel
        title="Find music"
        meta={kind === 'song' ? 'Apple catalogue · exact recording' : 'Apple catalogue · a rotating handful of top songs'}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '4px 0 16px' }}>
          <div
            style={{
              display: 'flex',
              gap: 1,
              padding: 2,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              border: LINE.edge,
              flex: 'none'
            }}
          >
            {(['song', 'artist'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  font: `500 11.5px/1.2 ${FONT.mono}`,
                  background: kind === k ? 'rgba(63,179,166,0.16)' : 'transparent',
                  color: kind === k ? C.ok : C.t3
                }}
              >
                {k}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQ(term.trim());
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              height: 44,
              padding: '0 15px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.045)',
              border: '1px solid rgba(255,255,255,0.1)',
              flex: '1 1 300px',
              minWidth: 0,
              maxWidth: 460
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.45)', display: 'flex' }}>
              <Icon name="magnifyingglass" size={15} />
            </span>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={kind === 'song' ? 'song or artist name' : 'artist name'}
              aria-label="Search the Apple catalogue"
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                font: `400 13.5px/1 ${FONT.text}`,
                color: 'rgba(255,255,255,0.82)'
              }}
            />
          </form>
        </div>

        {q.trim().length < 2 ? (
          <Empty text="Type at least two characters and press enter. Search runs against the Apple catalogue on the backend, so this dashboard never holds an Apple token." />
        ) : (
          <Source data={search} what="Catalogue search" skeleton={<SkelCards />}>
            {() =>
              results.length ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {results.map((r) => (
                    <ResultCard
                      key={r.appleId}
                      r={r}
                      kind={kind}
                      alreadyPromoted={promotedIds.has(r.appleId)}
                      busy={create.isPending}
                      onPromote={(opts) =>
                        create.mutate({
                          kind,
                          appleId: r.appleId,
                          targetGenres: r.genres?.length ? r.genres : undefined,
                          ...opts
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <Empty text={`Nothing in the catalogue matched "${q}".`} />
              )
            }
          </Source>
        )}

        {create.isError && <WriteError err={create.error} />}
        {create.isSuccess && create.data && <Saved p={create.data as Promotion} />}
      </Panel>

      {/* ── What is currently promoted ────────────────────────────────────── */}
      <Panel
        title="Promotions"
        meta={
          <button
            type="button"
            onClick={() => setIncludeRetired((v) => !v)}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              font: `400 11px/1 ${FONT.mono}`,
              color: includeRetired ? C.ok : C.t3
            }}
          >
            {includeRetired ? 'showing retired' : 'active only'}
          </button>
        }
      >
        <Source data={list} what="Promotions" skeleton={<SkelRows rows={3} cols={[null, 90, 90, 80]} />}>
          {(d) => {
            // The reach bar is relative to the busiest campaign, so it answers
            // "which of these is actually landing" rather than implying a target
            // nobody set. One promotion gets no bar - there is nothing to compare.
            const peak = Math.max(...d.promotions.map((p) => p.served), 1);
            return d.promotions.length ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {d.promotions.map((p) => (
                  <PromotionCard
                    key={p.id}
                    p={p}
                    peak={d.promotions.length > 1 ? peak : 0}
                    busy={retire.isPending}
                    onRetire={() => retire.mutate(p.id)}
                  />
                ))}
              </div>
            ) : (
              <Empty text={includeRetired ? 'Nothing has ever been promoted.' : 'No active promotions.'} />
            );
          }}
        </Source>

        {retire.isError && <WriteError err={retire.error} />}

        <div style={{ paddingTop: 16 }}>
          <Prose max={80}>
            <strong style={{ fontWeight: 500, color: C.warnText }}>
              Served and listeners are different numbers.
            </strong>{' '}
            Two impressions on one listener is not the reach of one each on two, and the cap is per listener - so a
            promotion can look busy while touching almost nobody. And the station preview does not record impressions
            and is not capped, deliberately, so an operator checking a brief does not burn someone&rsquo;s daily
            allowance. That means{' '}
            <strong style={{ fontWeight: 500, color: '#fff' }}>a promoted track appears more often in preview than in
            the product</strong>: read reach from served, never from how often you saw it while testing.
          </Prose>
        </div>
      </Panel>
    </div>
  );
}

/* ── Search result ──────────────────────────────────────────────────────── */

type PromoOpts = { weight?: number; dailyCapPerUser?: number };

/**
 * A record, presented as one.
 *
 * Artwork is not decoration here: an operator picking from a list of names is
 * choosing between text that reads identically for a remaster, a live cut and a
 * covers act with the same title. The sleeve is how you know you got the right
 * one, so it leads and it is large enough to recognise.
 */
function ResultCard({
  r,
  kind,
  alreadyPromoted,
  busy,
  onPromote
}: {
  r: PromoSearchResult;
  kind: 'song' | 'artist';
  alreadyPromoted: boolean;
  busy: boolean;
  onPromote: (opts: PromoOpts) => void;
}) {
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState(1);
  const [cap, setCap] = useState(2);
  const noGenres = !r.genres?.length;

  return (
    <div
      style={{ ...CARD, padding: 16, transition: `transform ${MOTION}, box-shadow ${MOTION}` }}
      onMouseEnter={(e) => !alreadyPromoted && Object.assign(e.currentTarget.style, focusLift(true))}
      onMouseLeave={(e) => Object.assign(e.currentTarget.style, focusLift(false))}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Art src={artworkUrl(r.artwork, 72)} size={72} round={kind === 'artist'} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `500 15px/1.3 ${FONT.text}`, color: '#fff', letterSpacing: '-0.01em' }}>{r.name}</div>
          {r.artistName && (
            <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: C.t2, marginTop: 3 }}>{r.artistName}</div>
          )}
          {/*
            The genres ARE the targeting seed. A promotion whose genres match no
            pool it could plausibly land in never serves, and nothing in the data
            afterwards explains why - so they are shown before the operator
            commits, which the search response makes free.
          */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
            {noGenres ? (
              <span style={{ font: `400 11px/1.6 ${FONT.mono}`, color: C.warnText }}>
                no genres - this would be refused, not saved
              </span>
            ) : (
              r.genres.map((g) => <GenreChip key={g} g={g} />)
            )}
          </div>
        </div>

        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          {alreadyPromoted ? (
            // Not a disabled button with a tooltip: the fact is already on this
            // page, so saying it is cheaper than making them click to find out.
            <span
              style={{
                padding: '7px 13px',
                borderRadius: 8,
                font: `500 11.5px/1.2 ${FONT.mono}`,
                background: 'rgba(63,179,166,0.10)',
                color: C.ok,
                border: '1px solid rgba(63,179,166,0.28)'
              }}
            >
              promoted
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                title="Weight and daily cap"
                style={{
                  height: 34,
                  padding: '0 11px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.11)',
                  background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
                  color: open ? '#fff' : C.t3,
                  font: `400 11.5px/1 ${FONT.mono}`,
                  cursor: 'pointer'
                }}
              >
                {weight === 1 && cap === 2 ? 'options' : `×${weight} · ${cap}/day`}
              </button>
              <button
                type="button"
                disabled={busy || noGenres}
                onClick={() => onPromote({ weight, dailyCapPerUser: cap })}
                style={{
                  height: 34,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: `1px solid ${busy || noGenres ? 'rgba(255,255,255,0.08)' : 'rgba(63,179,166,0.45)'}`,
                  background: busy || noGenres ? 'rgba(255,255,255,0.03)' : 'rgba(63,179,166,0.14)',
                  color: busy || noGenres ? C.t3 : C.ok,
                  font: `500 12.5px/1 ${FONT.text}`,
                  cursor: busy ? 'wait' : noGenres ? 'not-allowed' : 'pointer',
                  transition: `background ${MOTION}`
                }}
              >
                {busy ? 'Saving…' : 'Promote'}
              </button>
            </>
          )}
        </div>
      </div>

      {/*
        Campaign controls, behind a click.

        The defaults are the right answer nearly every time, and putting two
        numeric fields on every row would make a picker look like a form. They
        appear when someone actually wants them, with the API's own clamps shown
        rather than enforced silently - a value that gets quietly changed on save
        is a number you cannot stand behind.
      */}
      {open && !alreadyPromoted && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 18,
            marginTop: 14,
            paddingTop: 14,
            borderTop: LINE.row
          }}
        >
          <Stepper
            label="Weight"
            hint="0.1 to 10 · how hard it competes, never a guarantee"
            value={weight}
            step={0.5}
            min={0.1}
            max={10}
            onChange={setWeight}
          />
          <Stepper
            label="Daily cap per listener"
            hint="1 to 20 · verified at 2/2 giving zero further appearances"
            value={cap}
            step={1}
            min={1}
            max={20}
            onChange={setCap}
          />
        </div>
      )}
    </div>
  );
}

/* ── An active or retired promotion ─────────────────────────────────────── */

function PromotionCard({
  p,
  peak,
  busy,
  onRetire
}: {
  p: Promotion;
  peak: number;
  busy: boolean;
  onRetire: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const guessed = p.featureSource === 'genre';

  return (
    <div
      style={{
        ...CARD,
        padding: 16,
        opacity: p.active ? 1 : 0.5,
        borderColor: guessed && p.active ? 'rgba(224,160,48,0.32)' : 'rgba(255,255,255,0.075)'
      }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Art src={artworkUrl(p.artwork, 64)} size={64} round={p.kind === 'artist'} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ font: `500 15px/1.3 ${FONT.text}`, color: '#fff', letterSpacing: '-0.01em' }}>{p.name}</span>
            <span style={{ font: `400 11px/1.5 ${FONT.mono}`, color: C.t3 }}>{p.kind}</span>
            {!p.active && <span style={{ font: `500 10.5px/1.5 ${FONT.mono}`, color: C.t3 }}>retired</span>}
          </div>
          {p.artistName && (
            <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: C.t2, marginTop: 3 }}>{p.artistName}</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9, alignItems: 'center' }}>
            {(p.targetGenres ?? []).map((g) => (
              <GenreChip key={g} g={g} />
            ))}
            <FeatureSource value={p.featureSource} />
          </div>
        </div>

        {/*
          Reach, not activity. `served` counts impressions and `listeners` counts
          people, and the cap is per listener - so these diverge, and the pair is
          the only honest answer to "is this reaching anyone".
        */}
        <div style={{ flex: 'none', textAlign: 'right', minWidth: 104 }}>
          <div style={{ ...num, font: `500 19px/1 ${FONT.mono}`, color: p.served ? C.t1 : C.t3 }}>
            {p.served.toLocaleString()}
          </div>
          <div style={{ font: `400 10.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 4 }}>
            served · {p.listeners.toLocaleString()} listener{p.listeners === 1 ? '' : 's'}
          </div>
        </div>

        <div style={{ flex: 'none', textAlign: 'right', minWidth: 68 }}>
          <div style={{ ...num, font: `400 12px/1 ${FONT.mono}`, color: C.t2 }}>×{p.weight}</div>
          <div style={{ font: `400 10.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 4 }}>{p.dailyCapPerUser}/day</div>
        </div>

        {p.active && (
          /*
            Two steps, because this takes music away from listeners.

            Not a modal - a modal for a reversible act is theatre. The button
            states what the second click does, and retiring is idempotent and
            re-promotable, so the cost of a mistake is low but not zero.
          */
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirming ? onRetire() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
            title="Retire, not delete - the impression history is the only record of what was served"
            style={{
              flex: 'none',
              height: 32,
              padding: '0 13px',
              borderRadius: 8,
              border: `1px solid ${confirming ? 'rgba(255,98,89,0.45)' : 'rgba(255,255,255,0.13)'}`,
              background: confirming ? 'rgba(255,98,89,0.12)' : 'rgba(255,255,255,0.05)',
              color: busy ? C.t3 : confirming ? C.bad : 'rgba(255,255,255,0.8)',
              font: `500 12px/1 ${FONT.text}`,
              cursor: busy ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
              transition: `background ${MOTION}`
            }}
          >
            {busy ? 'Retiring…' : confirming ? 'Confirm retire' : 'Retire'}
          </button>
        )}
      </div>

      {/* Relative to the busiest campaign, so it answers "which is landing"
          rather than implying a target nobody set. */}
      {peak > 0 && (
        <div style={{ marginTop: 14 }}>
          <Bar pct={(p.served / peak) * 100} color={p.active ? C.okDim : 'rgba(255,255,255,0.16)'} />
        </div>
      )}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Stepper({
  label,
  hint,
  value,
  step,
  min,
  max,
  onChange
}: {
  label: string;
  hint: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 10) / 10));
  const btn = (t: string, d: number) => (
    <button
      type="button"
      onClick={() => onChange(clamp(value + d))}
      aria-label={`${t === '-' ? 'Decrease' : 'Increase'} ${label}`}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.11)',
        background: 'rgba(255,255,255,0.04)',
        color: 'rgba(255,255,255,0.75)',
        font: `400 13px/1 ${FONT.mono}`,
        cursor: 'pointer'
      }}
    >
      {t}
    </button>
  );
  return (
    <div style={{ minWidth: 190 }}>
      <div
        style={{
          font: `600 9.5px/1 ${FONT.text}`,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: C.t3,
          marginBottom: 9
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {btn('−', -step)}
        <span style={{ ...num, minWidth: 38, textAlign: 'center', font: `500 14px/1 ${FONT.mono}`, color: '#fff' }}>
          {value}
        </span>
        {btn('+', step)}
      </div>
      <div style={{ font: `400 10.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 8, maxWidth: '34ch' }}>{hint}</div>
    </div>
  );
}

/**
 * `featureSource` is the field that decides whether this feature works at all.
 *
 * The recommender drops any candidate it has no audio features for, and those
 * come from a frozen 2024 dataset with 77% coverage - new releases are
 * disproportionately in the missing 23%, which is exactly what gets promoted.
 * "7563" has no features of its own; injected naively it would have been dropped
 * on every request, with the pool building fine, nothing erroring, and the track
 * simply never airing.
 *
 * Only `genre` is coloured, because only `genre` changes what to expect: it will
 * play, it may just sit oddly next to its neighbours. `sibling` is common and
 * normal for anything recently released, and colouring it would cry wolf.
 */
function FeatureSource({ value }: { value: Promotion['featureSource'] }) {
  const copy: Record<Promotion['featureSource'], { label: string; title: string }> = {
    track: { label: 'own features', title: 'Sequenced from this recording’s own audio features.' },
    sibling: {
      label: 'sibling features',
      title:
        'No features for this recording, which is normal for anything recently released. Sequenced from the median of the artist’s covered tracks.'
    },
    genre: {
      label: 'genre default',
      title:
        'No audio features for this recording or its siblings. Placed on genre alone, so sequencing is approximate - it will play, it may sit oddly next to its neighbours.'
    }
  };
  const c = copy[value] ?? copy.track;
  const warn = value === 'genre';
  return (
    <span
      title={c.title}
      style={{
        padding: '2px 8px',
        borderRadius: 5,
        font: `500 10.5px/1.6 ${FONT.mono}`,
        background: warn ? 'rgba(224,160,48,0.16)' : 'rgba(255,255,255,0.05)',
        color: warn ? C.warnText : C.t3,
        cursor: 'help'
      }}
    >
      {warn ? '⚠ ' : ''}
      {c.label}
    </span>
  );
}

const GenreChip = ({ g }: { g: string }) => (
  <span
    style={{
      padding: '2px 8px',
      borderRadius: 5,
      font: `400 10.5px/1.6 ${FONT.mono}`,
      background: 'rgba(63,179,166,0.10)',
      color: '#7BCFC5'
    }}
  >
    {g}
  </span>
);

/**
 * Artwork, with a placeholder that is obviously a placeholder.
 *
 * `artwork` is nullable - Apple omits it on a few catalogue entries and a
 * promotion is perfectly serveable without one - and the CDN can 404 an
 * individual size. A broken-image icon in a dark UI reads as a rendering fault,
 * so the fallback is a plain tile with a note glyph: "no sleeve", not "something
 * is broken".
 */
function Art({ src, size, round }: { src: string | null; size: number; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  const shape = { width: size, height: size, borderRadius: round ? '50%' : 11, flex: 'none' as const };
  if (!src || failed)
    return (
      <div
        style={{
          ...shape,
          background: 'rgba(255,255,255,0.05)',
          border: LINE.edge,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.t3
        }}
      >
        <Icon name="mic.fill" size={Math.round(size / 3)} />
      </div>
    );
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      style={{
        ...shape,
        objectFit: 'cover',
        background: 'rgba(255,255,255,0.05)',
        border: LINE.edge,
        boxShadow: '0 6px 18px -10px rgba(0,0,0,0.8)'
      }}
    />
  );
}

/** The write failed. Say which failure, because each one needs a different move. */
function WriteError({ err }: { err: unknown }) {
  const reason = (err as any)?.reason ?? 'unknown';
  const detail = (err as any)?.detail;
  const text: Record<string, string> = {
    already_promoted: 'Already promoted. Retire the existing promotion before creating a new one for the same act.',
    not_in_storefront:
      'No such id in that storefront. The catalogue is per-storefront, so an id from one may not exist in another.',
    bad_request:
      'The backend refused it. Most often no target genres could be resolved - and empty targeting matches nothing rather than everything, so it would have saved quietly and never fired.'
  };
  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid rgba(255,98,89,0.28)',
        background: 'rgba(255,98,89,0.06)',
        borderRadius: 12,
        padding: '14px 16px'
      }}
    >
      <div
        style={{
          font: `600 10px/1 ${FONT.text}`,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: C.bad,
          marginBottom: 8
        }}
      >
        Not saved
      </div>
      <div style={{ font: `400 12.5px/1.6 ${FONT.text}`, color: C.t2, maxWidth: '78ch' }}>
        {text[reason] ?? `The backend returned ${reason}.`}
        {detail && <span style={{ color: C.t3 }}> {detail}</span>}
      </div>
    </div>
  );
}

/** Confirmation that says the one thing worth knowing about what just saved. */
function Saved({ p }: { p: Promotion }) {
  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid rgba(63,179,166,0.3)',
        background: 'rgba(63,179,166,0.07)',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        gap: 14,
        alignItems: 'center'
      }}
    >
      <Art src={artworkUrl(p.artwork, 44)} size={44} round={p.kind === 'artist'} />
      <div style={{ minWidth: 0 }}>
        <div style={{ font: `500 13.5px/1.45 ${FONT.text}`, color: '#fff' }}>
          {p.name} is promoted, targeting {(p.targetGenres ?? []).join(', ') || 'nothing'}.
        </div>
        <div style={{ font: `400 12px/1.6 ${FONT.text}`, color: C.t2, marginTop: 4, maxWidth: '78ch' }}>
          {p.featureSource === 'genre'
            ? 'Sequencing is approximate: no audio features exist for this recording or its siblings, so it was placed on genre alone. It will play; it may sit oddly next to its neighbours.'
            : p.featureSource === 'sibling'
              ? 'No audio features for this exact recording - normal for a recent release - so it was sequenced from the median of the artist’s covered tracks.'
              : 'Sequenced from the recording’s own audio features.'}{' '}
          It competes for a slot from the next pool build; it is not guaranteed to air.
        </div>
      </div>
    </div>
  );
}

/**
 * A viewer sees why, not a 404.
 *
 * Calling these routes without `operator` returns a bare 404 that this dashboard
 * would report as an unreadable source - sending someone to look for an outage
 * that is really a permission. So the client does not make the call at all.
 */
const NotOperator = () => (
  <div style={{ ...CARD, padding: 'clamp(22px,2.6vw,30px)', maxWidth: '68ch' }}>
    <div style={{ font: `500 16px/1.4 ${FONT.display}`, color: '#fff', marginBottom: 8 }}>
      Promoting music needs the operator role
    </div>
    <div style={{ font: `400 13px/1.6 ${FONT.text}`, color: C.t2 }}>
      Reading this dashboard and deciding what listeners hear are different privileges. Your role is resolved
      server-side on every request, so this is not something a token can carry - ask an owner to grant operator in{' '}
      <code style={{ font: `400 12px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>admin_users</code>.
    </div>
  </div>
);

const SkelCards = () => (
  <div style={{ display: 'grid', gap: 12 }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ ...CARD, padding: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Skel w={72} h={72} r={11} />
        <span style={{ flex: 1, display: 'grid', gap: 9 }}>
          <Skel w={`${46 + i * 9}%`} h={14} />
          <Skel w="30%" h={11} />
          <Skel w="42%" h={11} />
        </span>
        <Skel w={92} h={34} r={8} />
      </div>
    ))}
  </div>
);

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.55 ${FONT.text}`, color: C.t3, maxWidth: '76ch' }}>{text}</div>
);
