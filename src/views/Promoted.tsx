import { useState } from 'react';
import type { Ctx } from '../App';
import { C, CARD, FONT, LINE, MOTION, GAP, focusLift, num } from '../theme';
import { Icon } from '../icons';
import { Callout, Panel, Prose, Skel, SkelRows, Source } from '../components/primitives';
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
 * "they ignored me", and it is enforced in the recommendation path rather than
 * by convention here.
 *
 * Every panel on this page is gated on `can.operate`. Reading a dashboard and
 * deciding what listeners hear are different privileges, and the backend answers
 * a viewer with a bare 404 that is indistinguishable from the rate limiter - so
 * a viewer who reached these calls would see "source could not be read" and go
 * looking for an outage that does not exist.
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

  return (
    <div style={{ display: 'grid', gap: GAP }}>
      <Callout tone="teal" icon>
        A promotion <strong style={{ fontWeight: 500, color: '#fff' }}>competes</strong>, it is not a guaranteed slot -
        it enters the same candidate pool as everything else and can lose on merit. It will never override a dislike at
        any weight, never appear in a station whose brief excludes it, and is capped per listener per day. Targeting
        fires on the genres a pool actually came back with, not on anything declared up front.
      </Callout>

      {/* ── Find something to promote ─────────────────────────────────────── */}
      <Panel
        title="Find music"
        meta={kind === 'song' ? 'Apple catalogue · exact recording' : 'Apple catalogue · a rotating handful of top songs'}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '4px 0 14px' }}>
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

        {/*
          Two characters is a 400 on the backend, so the empty and one-character
          states say what to do rather than rendering a failure the operator
          caused by starting to type.
        */}
        {q.trim().length < 2 ? (
          <Empty text="Type at least two characters and press enter. Search runs against the Apple catalogue on the backend, so this dashboard never holds an Apple token." />
        ) : (
          <Source data={search} what="Catalogue search" skeleton={<SkelCards />}>
            {() =>
              results.length ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {results.map((r) => (
                    <ResultCard
                      key={r.appleId}
                      r={r}
                      kind={kind}
                      busy={create.isPending}
                      onPromote={() =>
                        create.mutate({ kind, appleId: r.appleId, targetGenres: r.genres?.length ? r.genres : undefined })
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
          {(d) =>
            d.promotions.length ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {d.promotions.map((p) => (
                  <PromotionCard
                    key={p.id}
                    p={p}
                    busy={retire.isPending}
                    onRetire={() => retire.mutate(p.id)}
                  />
                ))}
              </div>
            ) : (
              <Empty text={includeRetired ? 'Nothing has ever been promoted.' : 'No active promotions.'} />
            )
          }
        </Source>

        {retire.isError && <WriteError err={retire.error} />}

        <div style={{ paddingTop: 14 }}>
          <Prose max={80}>
            Sleeves are missing here because <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>/admin/promotions</code>{' '}
            returns <code style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.7)' }}>appleId</code>{' '}
            but no artwork, and this dashboard holds no Apple token to resolve one - a request is with the backend.
            Uniformly absent rather than sometimes present: caching the URL when you promote would put sleeves on the
            ones made in this browser and not the rest, which is harder to read than none at all.
          </Prose>
        </div>
        <div style={{ paddingTop: 10 }}>
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

/**
 * Artwork earns its place here rather than decorating.
 *
 * An operator picking a record from a list of names is choosing from text that
 * looks identical for a remaster, a live version and a covers act with the same
 * title. The sleeve is how you know you got the right one, which is why this is
 * a card with an image rather than a table row.
 */
function ResultCard({
  r,
  kind,
  busy,
  onPromote
}: {
  r: PromoSearchResult;
  kind: 'song' | 'artist';
  busy: boolean;
  onPromote: () => void;
}) {
  const art = artworkUrl(r.artwork, 64);
  return (
    <div
      style={{
        ...CARD,
        padding: 14,
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        transition: `transform ${MOTION}, box-shadow ${MOTION}`
      }}
      onMouseEnter={(e) => Object.assign(e.currentTarget.style, focusLift(true))}
      onMouseLeave={(e) => Object.assign(e.currentTarget.style, focusLift(false))}
    >
      <Art src={art} size={64} round={kind === 'artist'} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `500 14px/1.35 ${FONT.text}`, color: '#fff', letterSpacing: '-0.008em' }}>{r.name}</div>
        {r.artistName && (
          <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: C.t2, marginTop: 2 }}>{r.artistName}</div>
        )}
        {/*
          The genres ARE the targeting seed, and a promotion whose genres match
          no pool it could plausibly land in simply never serves - with nothing
          in the data afterwards to explain why. The search result carries them,
          so showing them before the operator commits costs nothing.
        */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {r.genres?.length ? (
            r.genres.map((g) => <GenreChip key={g} g={g} />)
          ) : (
            <span style={{ font: `400 11px/1.6 ${FONT.mono}`, color: C.warnText }}>
              no genres - would be refused, not saved
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onPromote}
        style={{
          flex: 'none',
          height: 34,
          padding: '0 15px',
          borderRadius: 8,
          border: `1px solid ${busy ? 'rgba(255,255,255,0.08)' : 'rgba(63,179,166,0.45)'}`,
          background: busy ? 'rgba(255,255,255,0.03)' : 'rgba(63,179,166,0.12)',
          color: busy ? C.t3 : C.ok,
          font: `500 12px/1 ${FONT.text}`,
          cursor: busy ? 'wait' : 'pointer',
          transition: `background ${MOTION}`
        }}
      >
        {busy ? 'Saving…' : 'Promote'}
      </button>
    </div>
  );
}

/* ── An active or retired promotion ─────────────────────────────────────── */

function PromotionCard({ p, busy, onRetire }: { p: Promotion; busy: boolean; onRetire: () => void }) {
  // No sleeve here, uniformly - see the Promotion type. The tile stays so the
  // row keeps the same shape as a search result, and the panel says why once
  // rather than each card implying its own image failed.
  const guessed = p.featureSource === 'genre';
  return (
    <div
      style={{
        ...CARD,
        padding: 14,
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        opacity: p.active ? 1 : 0.55,
        borderColor: guessed && p.active ? 'rgba(224,160,48,0.32)' : 'rgba(255,255,255,0.075)'
      }}
    >
      <Art src={null} size={56} round={p.kind === 'artist'} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ font: `500 14px/1.35 ${FONT.text}`, color: '#fff' }}>{p.name}</span>
          <span style={{ font: `400 11px/1.5 ${FONT.mono}`, color: C.t3 }}>{p.kind}</span>
          {!p.active && (
            <span style={{ font: `500 10.5px/1.5 ${FONT.mono}`, color: C.t3 }}>retired</span>
          )}
        </div>
        {p.artistName && (
          <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: C.t2, marginTop: 2 }}>{p.artistName}</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
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
      <div style={{ flex: 'none', textAlign: 'right', minWidth: 92 }}>
        <div style={{ ...num, font: `500 15px/1 ${FONT.mono}`, color: p.served ? C.t1 : C.t3 }}>
          {p.served.toLocaleString()}
        </div>
        <div style={{ font: `400 10.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 3 }}>
          served to {p.listeners.toLocaleString()} listener{p.listeners === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ flex: 'none', textAlign: 'right', minWidth: 72 }}>
        <div style={{ ...num, font: `400 12px/1 ${FONT.mono}`, color: C.t2 }}>×{p.weight}</div>
        <div style={{ font: `400 10.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 3 }}>
          max {p.dailyCapPerUser}/day
        </div>
      </div>

      {p.active && (
        <button
          type="button"
          disabled={busy}
          onClick={onRetire}
          title="Retire, not delete - the impression history is the only record of what was served"
          style={{
            flex: 'none',
            height: 32,
            padding: '0 13px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.13)',
            background: 'rgba(255,255,255,0.05)',
            color: busy ? C.t3 : 'rgba(255,255,255,0.8)',
            font: `500 12px/1 ${FONT.text}`,
            cursor: busy ? 'wait' : 'pointer'
          }}
        >
          Retire
        </button>
      )}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/**
 * `featureSource` is the field that decides whether this feature works at all.
 *
 * The recommender drops any candidate it has no audio features for, and those
 * come from a frozen 2024 dataset with 77% coverage - new releases are
 * disproportionately in the missing 23%, which is exactly what gets promoted.
 * "7563" by Florence Road has no features of its own; injected naively it would
 * have been dropped on every request, with the pool building fine, nothing
 * erroring, and the track simply never airing.
 *
 * So a promotion is classified when it is saved, and this says how:
 *
 *   track    the recording's own features - nothing to say
 *   sibling  median of the artist's covered tracks - fine, worth a quiet note
 *   genre    a genre default - we know nothing about how it actually SOUNDS
 *
 * Only `genre` is coloured, because only `genre` changes what an operator should
 * expect: it will play, it may just sit oddly next to its neighbours. Worth
 * seeing before a campaign goes out rather than after.
 */
function FeatureSource({ value }: { value: Promotion['featureSource'] }) {
  const copy: Record<Promotion['featureSource'], { label: string; title: string }> = {
    track: { label: 'own features', title: 'Sequenced from this recording’s own audio features.' },
    sibling: {
      label: 'sibling features',
      title: 'No features for this recording. Sequenced from the median of the artist’s covered tracks.'
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
 * Apple's CDN can and does 404 individual sizes, and a broken image icon in a
 * dark UI reads as a rendering fault. The fallback is a plain tile with a note
 * glyph - it says "no sleeve" rather than "something is broken".
 */
function Art({ src, size, round }: { src: string | null; size: number; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  const shape = { width: size, height: size, borderRadius: round ? '50%' : 9, flex: 'none' as const };
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
      style={{ ...shape, objectFit: 'cover', background: 'rgba(255,255,255,0.05)', border: LINE.edge }}
    />
  );
}

/** The write failed. Say which failure, because each one needs a different move. */
function WriteError({ err }: { err: unknown }) {
  const reason = (err as any)?.reason ?? 'unknown';
  const detail = (err as any)?.detail;
  const text: Record<string, string> = {
    already_promoted: 'Already promoted. Retire the existing promotion before creating a new one for the same act.',
    not_in_storefront: 'No such id in that storefront. The catalogue is per-storefront, so an id from one may not exist in another.',
    bad_request:
      'The backend refused it. Most often no target genres could be resolved - and empty targeting matches nothing rather than everything, so it would have saved quietly and never fired.'
  };
  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid rgba(255,98,89,0.28)',
        background: 'rgba(255,98,89,0.06)',
        borderRadius: 10,
        padding: '13px 15px'
      }}
    >
      <div style={{ font: `600 10px/1 ${FONT.text}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.bad, marginBottom: 7 }}>
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
        marginTop: 14,
        border: '1px solid rgba(63,179,166,0.3)',
        background: 'rgba(63,179,166,0.07)',
        borderRadius: 10,
        padding: '13px 15px'
      }}
    >
      <div style={{ font: `500 13px/1.5 ${FONT.text}`, color: '#fff' }}>
        {p.name} is promoted, targeting {(p.targetGenres ?? []).join(', ') || 'nothing'}.
      </div>
      <div style={{ font: `400 12px/1.6 ${FONT.text}`, color: C.t2, marginTop: 5, maxWidth: '78ch' }}>
        {p.featureSource === 'genre'
          ? 'Sequencing is approximate: no audio features exist for this recording or its siblings, so it was placed on genre alone. It will play; it may sit oddly next to its neighbours.'
          : p.featureSource === 'sibling'
            ? 'No audio features for this exact recording, so it was sequenced from the median of the artist’s covered tracks.'
            : 'Sequenced from the recording’s own audio features.'}{' '}
        It competes for a slot from the next pool build; it is not guaranteed to air.
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
  <div style={{ display: 'grid', gap: 10 }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ ...CARD, padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
        <Skel w={64} h={64} r={9} />
        <span style={{ flex: 1, display: 'grid', gap: 8 }}>
          <Skel w={`${46 + i * 9}%`} h={13} />
          <Skel w="30%" h={11} />
          <Skel w="42%" h={10} />
        </span>
        <Skel w={78} h={34} r={8} />
      </div>
    ))}
  </div>
);

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.55 ${FONT.text}`, color: C.t3, maxWidth: '76ch' }}>{text}</div>
);
