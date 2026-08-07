import { useState } from 'react';
import type { Ctx } from '../App';
import { BG, C, CARD, ELEV, FONT, GAP, LINE, MOTION, dot, focusLift, num, stateColour } from '../theme';
import { Icon } from '../icons';
import { Generated, KeyRow, SectionHead, Skel, Source, Panel, SkelKeyRows, SkelRows } from '../components/primitives';
import {
  reasonText,
  statValue,
  useAdminStats,
  useAeProbe,
  useCron,
  useNarrative,
  useOnAir,
  useSetlistFill,
  useVersions
} from '../lib/api';
import { useHealth, type Signal } from '../lib/health';
import { STATE } from '../lib/vocabulary';
import * as fx from '../lib/fixtures';

export default function Overview({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const stats = useAdminStats(!demo);
  const probe = useAeProbe();
  const versions = useVersions();
  const setlists = useSetlistFill(Math.min(ctx.hours, 72), !demo);
  const cron = useCron(!demo);
  const onAir = useOnAir(!demo);

  // Verdict and signals come from the same derivation the nav badges use, so the
  // number on the badge, the number in the verdict and the rows below always
  // agree. Two counts of the same thing that disagree is the failure this whole
  // tool exists to prevent.
  const { signals, verdict, domains, attention } = useHealth(ctx.hours, demo, ctx.ownerTokenExpiresInDays);

  return (
    <div style={{ display: 'grid', gap: GAP }}>
      {/*
        The hero, in the tvOS sense: one surface carrying the single most
        important thing, with everything else deferring to it.

        The verdict and the three domain numbers used to be two stacked panels of
        identical treatment - same border, same fill, same weight - so the answer
        and its supporting detail competed. Apple TV builds hierarchy with layers
        rather than borders: the thing that matters lifts, the rest recedes. One
        raised surface, the verdict at the top of it, the domains reading as its
        evidence rather than as a second panel.
      */}
      {/*
        Two cards, not one card with two columns.

        These answer two independent questions - is the software healthy, is the
        station transmitting - and the giveaway that they had no business sharing
        a surface was the colour. The card's border and wash are keyed to the
        VERDICT tone, so a red "Degraded" border wrapped an on-air block reading
        "2 listening now" in teal. The station was fine; the software was not,
        and one surface made the verdict's colour a claim about content it does
        not describe. Everywhere else in this product a card is one object with
        one state, and these are two.

        Equal width on purpose. Neither outranks the other at 3am: a silent
        station with every engineering panel green is the failure mode this pair
        exists to catch, and sizing one down would say otherwise.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))',
          gap: GAP
        }}
      >
        {/* The answer, first in the reading order and largest on the page. */}
        <div
          style={{
            ...CARD,
            display: 'flex',
            alignItems: 'center',
            padding: 'clamp(22px,2.6vw,30px)',
            borderColor:
              verdict.tone === 'bad'
                ? 'rgba(255,98,89,0.3)'
                : verdict.tone === 'warn'
                  ? 'rgba(224,160,48,0.3)'
                  : // Loading is NOT teal. Every other branch here falls through to
                    // the healthy colour, and a "Reading 5 sources" headline wearing
                    // the healthy border says the thing it is waiting to find out.
                    verdict.tone === 'loading'
                    ? 'rgba(255,255,255,0.075)'
                    : 'rgba(63,179,166,0.22)',
            // A wash of the verdict colour rather than a filled card. The colour
            // still carries the state; it just stops shouting it. Layered OVER
            // the shared card fill, not instead of it - replacing it would make
            // this the one card on the page without the common surface.
            background: `${
              verdict.tone === 'bad'
                ? 'radial-gradient(120% 140% at 0% 0%, rgba(255,98,89,0.10) 0%, transparent 60%)'
                : verdict.tone === 'warn'
                  ? 'radial-gradient(120% 140% at 0% 0%, rgba(224,160,48,0.10) 0%, transparent 60%)'
                  : verdict.tone === 'loading'
                    ? 'none'
                    : 'radial-gradient(120% 140% at 0% 0%, rgba(63,179,166,0.09) 0%, transparent 60%)'
            }, ${CARD.background as string}`
          }}
        >
          <h2
            style={{
              margin: 0,
              minWidth: 0,
              font: `600 clamp(28px,3.4vw,40px)/1.05 ${FONT.display}`,
              letterSpacing: '-0.033em',
              color:
                verdict.tone === 'bad'
                  ? C.bad
                  : verdict.tone === 'warn'
                    ? C.warnText
                    : verdict.tone === 'loading'
                      ? C.t3
                      : C.ok
            }}
          >
            {verdict.title}
          </h2>
        </div>

        {/*
          Rad.FM is a radio station. The site's own eyebrow reads
          "ON AIR NOW - MORNING MAYHEM", and this dashboard could not answer the
          one question you would ask a control room: is it transmitting? Every
          panel measured whether the CODE was healthy; none measured whether the
          STATION was. This card carries its own state, in its own colour.
        */}
        <div style={{ ...CARD, padding: 'clamp(22px,2.6vw,30px)', minWidth: 0 }}>
          <OnAir state={onAir} demo={Boolean(demo)} />
        </div>
      </div>

      {/*
        The verdict's explanation, under the card rather than at the bottom of it.

        The hero is one surface carrying one statement: what is on air, and the
        verdict. The sentence that qualifies the verdict was sitting inside the
        same surface as its last element, which made the card carry two jobs and
        gave the sentence the weight of a headline it is not. Beneath the card it
        reads as a caption to the thing above - still the first prose on the page,
        still tied to the verdict, but no longer competing with it for the surface.
      */}
      <p
        style={{
          font: `400 14.5px/1.55 ${FONT.text}`,
          color: C.t2,
          margin: '-2px 0 0',
          padding: '0 2px',
          maxWidth: '68ch'
        }}
      >
        {verdict.sub}
      </p>

      {/*
        Three separate cards with real space between them, not cells fused into
        the hero by hairlines. Each is a distinct object you can look at on its
        own, which is what makes a tvOS layout calm: things sit apart rather than
        being packed into a grid.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))',
          gap: GAP
        }}
      >
          {domains.map((d) => (
            <button
              key={d.domain}
              type="button"
              onClick={() => ctx.go(d.go)}
              // tvOS focus: the thing under the cursor lifts toward you. Cheap,
              // and it turns a wall of equal boxes into something navigable.
              onMouseEnter={(e) => {
                Object.assign(e.currentTarget.style, focusLift(true));
                e.currentTarget.style.background = 'rgba(255,255,255,0.055)';
              }}
              onMouseLeave={(e) => {
                Object.assign(e.currentTarget.style, focusLift(false));
                e.currentTarget.style.background = CARD.background as string;
              }}
              style={{
                ...CARD,
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                position: 'relative',
                ...focusLift(false)
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={dot(
                    d.tone === 'bad'
                      ? C.bad
                      : d.tone === 'warn'
                        ? C.warn
                        : d.tone === 'dim' || d.tone === 'loading'
                          ? C.t3
                          : C.ok
                  )}
                />
                <span
                  style={{
                    font: `600 9.5px/1 ${FONT.text}`,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: C.t3
                  }}
                >
                  {d.domain}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                {/*
                  A skeleton, not the '-' this rendered before. A dash here is
                  the vocabulary for "we asked and got nothing", which is a
                  measured absence - and we have not asked yet.
                */}
                {d.tone === 'loading' ? (
                  <span style={{ display: 'block', padding: '4px 0' }}>
                    <Skel w={86} h={28} r={6} />
                  </span>
                ) : (
                  <span
                    style={{
                      ...num,
                      font: `500 clamp(26px,2.6vw,32px)/1 ${FONT.mono}`,
                      letterSpacing: '-0.025em',
                      color: d.tone === 'bad' ? C.bad : d.tone === 'dim' ? C.t3 : C.t1
                    }}
                  >
                    {d.value}
                  </span>
                )}
                <span style={{ font: `400 12px/1.4 ${FONT.text}`, color: C.t3 }}>{d.label}</span>
                {/*
                  Direction, only where a comparable prior window exists. Most of
                  these are null and stay null - an arrow against a baseline that
                  was never measured is worse than no arrow.
                */}
                {d.change && (
                  <span
                    style={{
                      ...num,
                      font: `500 11.5px/1 ${FONT.mono}`,
                      color: C.t2,
                      padding: '3px 6px',
                      borderRadius: 5,
                      background: 'rgba(255,255,255,0.05)'
                    }}
                  >
                    {/* Complete days only, so the wording has to say so. */}
                    {d.change.up ? '↑' : '↓'} {d.change.text.replace('-', '')} vs prior day
                  </span>
                )}
              </span>
              <span style={{ font: `400 12px/1.5 ${FONT.text}`, color: C.t2 }}>{d.detail}</span>
            </button>
          ))}
      </div>

      {/*
        What to do when nothing is wrong.
        
        The page previously said "Healthy - no signals open" and then offered
        five static cards and two tables: nothing to act on, nothing changed, no
        reason to have opened it. These are deliberately NOT signals and carry no
        severity colour - they are things worth knowing that are working as
        designed. A page that is only useful during an incident is unfamiliar
        during one.
      */}
      {attention.length > 0 && (
        <Panel title="Worth a look" meta="not faults">
          {attention.map((a) => (
            <button
              key={a.title}
              type="button"
              onClick={() => ctx.go(a.go)}
              onMouseEnter={(e) => {
                Object.assign(e.currentTarget.style, focusLift(true));
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
              onMouseLeave={(e) => {
                Object.assign(e.currentTarget.style, focusLift(false));
                e.currentTarget.style.background = 'transparent';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                width: '100%',
                textAlign: 'left',
                padding: '13px 10px 13px 2px',
                border: 'none',
                borderBottom: LINE.row,
                background: 'transparent',
                cursor: 'pointer',
                transition: `background ${MOTION}`
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `500 13.5px/1.4 ${FONT.text}`, color: '#fff' }}>{a.title}</div>
                <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 3 }}>{a.detail}</div>
              </div>
              <span style={{ color: C.t3, display: 'flex', flex: 'none' }}>
                <Icon name="chevron.right" size={11} />
              </span>
            </button>
          ))}
        </Panel>
      )}

      {!demo && signals.length >= 2 && (
        <Narrative signals={signals} verdict={verdict.title} hours={ctx.hours} />
      )}

      {/*
        An empty "Open signals" card is a titled box with nothing in it - the
        commonest state of this page, and the one where it read as broken rather
        than as calm. The verdict two cards up already says "no signals open", so
        a second empty frame repeating it is furniture. It renders when there is
        something in it and not otherwise.
      */}
      {signals.length > 0 && (
      <Panel title="Open signals" meta="ranked by blast radius">
        {signals.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => ctx.go(s.go)}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px 16px',
              alignItems: 'center',
              padding: '14px 0',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              borderBottom: LINE.row
            }}
          >
            {/* Severity is never colour alone: a dot, a metric colour and the wording all carry it. */}
            <span style={dot(s.sev === 'bad' ? C.bad : s.sev === 'warn' ? C.warn : 'rgba(255,255,255,0.3)', s.sev === 'bad')} />
            <div style={{ minWidth: 0, flex: '1 1 300px' }}>
              <div style={{ font: `500 14px/1.35 ${FONT.text}`, letterSpacing: '-0.008em', color: '#fff' }}>{s.title}</div>
              <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>
                {s.evidence}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    ...num,
                    font: `500 14px/1.2 ${FONT.mono}`,
                    color: s.sev === 'bad' ? C.bad : s.sev === 'warn' ? C.warn : C.t2
                  }}
                >
                  {s.metric}
                </div>
                <div style={{ font: `400 10px/1.5 ${FONT.mono}`, color: C.t3, marginTop: 3 }}>
                  {s.source}
                </div>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.3)', display: 'flex' }}>
                <Icon name="chevron.right" size={11} />
              </span>
            </div>
          </button>
        ))}
      </Panel>
      )}

      <ServiceState
        ctx={ctx}
        statsState={demo ? null : stats}
        probeOk={probe.state === 'ok' && probe.data.rows.length > 0}
        setlists={setlists}
        cron={cron}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 20 }}>
        <Panel title="Scale" meta="D1 · current state">
          {demo ? (
            fx.scaleRows.map((r) => <KeyRow key={r.label} label={r.label} value={r.value} note={r.note} />)
          ) : (
            <Source data={stats} what="D1 counts" skeleton={<SkelKeyRows rows={7} />}>
              {(d) => <ScaleRows d={d} />}
            </Source>
          )}
        </Panel>

        <Panel title="Deploys" meta="Workers Scripts · last 100">
          {demo ? (
            <>
              {fx.deploys.map((d) => (
                <DeployRow key={d.id} id={d.id} msg={d.msg} age={d.age} current={d.current} />
              ))}
              <div style={{ paddingTop: 12 }}>
                <RollbackButton allowed={ctx.can.operate} target="7b20e94" />
              </div>
            </>
          ) : (
            <Source data={versions} what="Deploy history" skeleton={<SkelRows rows={4} cols={[null, 40]} />}>
              {(d) => (
                <>
                  {d.versions.slice(0, 4).map((v: any) => (
                    <DeployRow
                      key={v.id}
                      id={String(v.id ?? '').slice(0, 7)}
                      msg={v.annotations?.['workers/message'] ?? v.metadata?.source ?? '-'}
                      age={relAge(v.metadata?.created_on ?? v.created_on)}
                      current
                    />
                  ))}
                  <div style={{ paddingTop: 12 }}>
                    <RollbackButton allowed={ctx.can.operate} target={String(d.versions?.[1]?.id ?? '').slice(0, 7)} />
                  </div>
                </>
              )}
            </Source>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Honest labels. `past_plays` stores current state rather than history, so this
 * figure means "users who played a song they had not played before, or replayed
 * one" - calling it DAU would be a lie with a number attached.
 */
function ScaleRows({ d }: { d: any }) {
  const rows: { label: string; value: number | null; note: string }[] = [
    { label: 'Registered users', value: statValue(d.users), note: d.newUsers7d != null ? `+${d.newUsers7d} in 7d` : '' },
    { label: 'Premium', value: statValue(d.premium), note: d.premiumPct == null ? 'pct unavailable' : `${d.premiumPct}%` },
    { label: 'Users with play activity, 24h', value: statValue(d.activeUsers24h), note: 'not DAU' },
    { label: 'Users with play activity, 7d', value: statValue(d.activeUsers7d), note: 'not WAU' },
    { label: 'Stations', value: statValue(d.stations), note: '100% user-gen' },
    { label: 'Past plays', value: statValue(d.plays), note: 'current state' },
    { label: 'Liked songs', value: statValue(d.liked), note: 'all have ISRC' }
  ];
  return (
    <>
      {rows.map((r) => (
        <KeyRow
          key={r.label}
          label={r.label}
          // -1 is a query-failed sentinel, not a count. It renders as
          // "unavailable" and never as 0.
          value={r.value === null ? 'unavailable' : r.value.toLocaleString()}
          note={r.note}
          color={r.value === null ? C.warnText : C.t1}
        />
      ))}
    </>
  );
}

function DeployRow({ id, msg, age, current }: { id: string; msg: string; age: string; current: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: LINE.row }}>
      <span style={dot(current ? C.ok : 'rgba(255,255,255,0.25)')} />
      <span style={{ font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.72)' }}>{id}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          font: `400 12.5px/1.4 ${FONT.text}`,
          color: 'rgba(255,255,255,0.55)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {msg}
      </span>
      <span style={{ font: `400 11px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.35)', flex: 'none' }}>{age}</span>
    </div>
  );
}

function RollbackButton({ allowed, target }: { allowed: boolean; target: string }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      // Two reasons, and the operator is told which applies. Hiding the control
      // would leave them unable to tell a missing feature from a missing permission.
      title={allowed ? 'Phase 4 - writes are not enabled yet' : 'Requires operator'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 34,
        padding: '0 14px',
        borderRadius: 7,
        font: `500 12.5px/1 ${FONT.text}`,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
        color: 'rgba(255,255,255,0.28)',
        cursor: 'not-allowed'
      }}
    >
      {allowed ? `Roll back to ${target || '-'}` : 'Roll back - requires operator'}
    </button>
  );
}

function ServiceState({
  ctx,
  statsState,
  probeOk,
  setlists,
  cron
}: {
  ctx: Ctx;
  statsState: ReturnType<typeof useAdminStats> | null;
  probeOk: boolean;
  setlists: ReturnType<typeof useSetlistFill>;
  cron: ReturnType<typeof useCron>;
}) {
  const demo = ctx.demo;
  const missing =
    statsState?.state === 'ok' ? statsState.data.dataQuality?.pastPlaysMissingPlayedAt : undefined;

  const cards = demo
    ? [
        { label: 'Migration 0003', value: 'Applied', detail: 'admin_users seeded, played_at backfilled', tone: 'ok' as const },
        {
          label: 'RevenueCat cron',
          value: demo === 'incident' ? 'Last run failed' : 'Ran 12m ago',
          detail: demo === 'incident' ? '0 */6 * * * · reconcile returned 502' : '0 */6 * * * · 18 rows reconciled',
          tone: demo === 'incident' ? ('bad' as const) : ('ok' as const)
        },
        { label: 'Data quality', value: '0 rows', detail: 'past_plays missing played_at', tone: 'ok' as const },
        { label: 'Analytics Engine', value: STATE.unverified, detail: 'never queried · needs scoped token', tone: 'warn' as const },
        {
          label: 'Setlist fill rate',
          value: demo === 'incident' ? '62%' : '75%',
          detail: demo === 'incident' ? 'below the 75% baseline' : 'at baseline · 100-event sample',
          tone: demo === 'incident' ? ('bad' as const) : ('ok' as const)
        }
      ]
    : [
        {
          label: 'Migration 0003',
          value: statsState?.state === 'ok' ? 'Applied' : STATE.unavailable,
          detail:
            statsState?.state === 'ok'
              ? 'admin_users readable, /admin/* responding'
              : 'every /admin/* route 404s until it runs',
          tone: statsState?.state === 'ok' ? ('ok' as const) : ('warn' as const)
        },
        cronCard(cron),
        {
          label: 'Data quality',
          value: missing === undefined ? STATE.unavailable : `${missing} rows`,
          detail: 'past_plays missing played_at',
          tone: missing === undefined ? ('warn' as const) : missing === 0 ? ('ok' as const) : ('bad' as const)
        },
        {
          label: 'Analytics Engine',
          value: probeOk ? 'Receiving' : STATE.unverified,
          detail: probeOk ? 'probe returned rows' : 'never queried · needs scoped token',
          tone: probeOk ? ('ok' as const) : ('warn' as const)
        },
        setlistCard(setlists)
      ];

  const abnormal = cards.filter((c) => c.tone !== 'ok');
  const normal = cards.filter((c) => c.tone === 'ok');

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      {/*
        ISA-101 Level 1: show what DEVIATES, collapse what does not.
        
        This rendered five cards every time, four of them saying nothing had
        happened. At 3am that is four things to read before reaching the one that
        matters. The passed checks stay on the page - "checked and normal" is a
        different claim from "not checked", and this dashboard does not get to
        blur those - but they take one line instead of four.
      */}
      {abnormal.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,215px),1fr))',
            gap: GAP
          }}
        >
          {abnormal.map((c) => (
            <div key={c.label} style={{ ...CARD, padding: '18px 20px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={dot(stateColour(c.tone))} />
                <span
                  style={{ font: `600 10px/1 ${FONT.text}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.t3 }}
                >
                  {c.label}
                </span>
              </div>
              <div style={{ font: `500 19px/1.25 ${FONT.display}`, letterSpacing: '-0.018em', color: stateColour(c.tone) }}>
                {c.value}
              </div>
              <div style={{ font: `400 11.5px/1.5 ${FONT.text}`, color: C.t3, marginTop: 5 }}>{c.detail}</div>
            </div>
          ))}
        </div>
      )}

      {normal.length > 0 && <NormalChecks cards={normal} />}
    </section>
  );
}

/**
 * The checks that passed, in one line until asked for.
 *
 * Safe to collapse precisely because only ok-toned cards reach it: hiding
 * "checked and normal" costs an operator nothing at a glance, whereas hiding
 * "could not check" would bury a real gap. That distinction is the whole reason
 * this is filtered on tone rather than on some idea of importance.
 */
function NormalChecks({ cards }: { cards: { label: string; value: string; detail: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...CARD, padding: open ? '16px 20px 10px' : '15px 20px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        <span style={dot(C.ok)} />
        <span style={{ font: `400 13px/1.4 ${FONT.text}`, color: C.t2, flex: 1, minWidth: 0 }}>
          {cards.length} service check{cards.length === 1 ? '' : 's'} normal
        </span>
        <span style={{ font: `400 11.5px/1 ${FONT.mono}`, color: C.t3 }}>{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div style={{ paddingTop: 12 }}>
          {cards.map((c) => (
            <div
              key={c.label}
              style={{ display: 'flex', gap: 14, padding: '9px 0', borderBottom: LINE.row, alignItems: 'baseline', flexWrap: 'wrap' }}
            >
              <span
                style={{ font: `600 9.5px/1 ${FONT.text}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.t3, width: 150 }}
              >
                {c.label}
              </span>
              <span style={{ font: `400 13px/1.4 ${FONT.text}`, color: C.ok, flex: '0 0 auto' }}>{c.value}</span>
              <span style={{ font: `400 12px/1.4 ${FONT.text}`, color: C.t3, flex: 1, minWidth: 0 }}>{c.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The cron card.
 *
 * `lastRunAt: null` is NOT healthy - the backend documents it as "never observed",
 * and this cron is the only server-initiated revocation path. It has been silently
 * misconfigured before, so rendering null as anything reassuring would recreate
 * exactly the failure this card exists to catch.
 */
function cronCard(cron: ReturnType<typeof useCron>) {
  if (cron.state !== 'ok')
    return { label: 'RevenueCat cron', value: STATE.unavailable, detail: 'could not read status', tone: 'warn' as const };

  const { lastRunAt, outcome, rowsReconciled, schedule } = cron.data;
  const cadence = schedule ?? '0 */6 * * *';
  if (!lastRunAt)
    return {
      label: 'RevenueCat cron',
      value: 'Never observed',
      detail: `${cadence} \u00b7 the only revocation path`,
      tone: 'bad' as const
    };

  const ageH = (Date.now() - new Date(`${lastRunAt.replace(' ', 'T')}Z`).getTime()) / 3_600_000;
  // Six-hourly. Two missed runs is a fault, not a blip.
  const overdue = !Number.isFinite(ageH) || ageH > 12;
  const failed = outcome !== undefined && outcome !== 'ok';
  return {
    label: 'RevenueCat cron',
    value: failed ? `Last run ${outcome}` : overdue ? 'Overdue' : `Ran ${Math.max(0, Math.round(ageH))}h ago`,
    detail: `${cadence} \u00b7 ${rowsReconciled ?? '\u2014'} rows reconciled`,
    tone: failed || overdue ? ('bad' as const) : ('ok' as const)
  };
}

/**
 * The setlist card.
 *
 * A 0/0 sample is NOT a 0% fill rate. It rendered as "0%" in red - a false zero
 * dressed as an outage, which is the same lie as a false "unavailable" and exactly
 * what this dashboard is meant to refuse to do. No gigs in the window means there
 * is nothing to report, so it says that.
 */
function setlistCard(setlists: ReturnType<typeof useSetlistFill>) {
  if (setlists.state !== 'ok')
    return {
      label: 'Setlist fill rate',
      value: STATE.unavailable,
      detail: 'could not read /admin/metrics/setlists',
      tone: 'warn' as const
    };

  const { fillRate, filled, sampled } = setlists.data;
  if (!sampled)
    return {
      label: 'Setlist fill rate',
      value: 'No sample',
      detail: 'no gigs in this window \u2014 not a 0% fill rate',
      tone: 'dim' as const
    };

  // 75% baseline, measured on a live 100-event London listing. Below 70% is the
  // shape of the bug that disabled setlists for a third of gigs.
  return {
    label: 'Setlist fill rate',
    value: `${Math.round(fillRate * 100)}%`,
    detail: `${filled}/${sampled} gigs enriched`,
    tone: fillRate < 0.7 ? ('bad' as const) : ('ok' as const)
  };
}

function relAge(iso?: string) {
  if (!iso) return '-';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '-';
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The generated narrative.
 *
 * It receives signals health.ts has ALREADY computed and writes prose about them.
 * It is never handed raw data to aggregate, because a subtly wrong number inside
 * fluent prose is far harder to catch than an obviously wrong one - and this is
 * the tool that exists because a wrong number looked fine.
 *
 * Three properties make it safe to put at the top of the page:
 *
 *   1. It sits BELOW the verdict, which is deterministic. If the prose and the
 *      verdict ever disagree, the verdict is the one that is measured.
 *   2. Citations are filtered Worker-side against the ids we sent, so a
 *      fabricated source cannot render. What you see cited, we supplied.
 *   3. It degrades like any other source. When inference is down the panel says
 *      so and states plainly that nothing measured is affected - because nothing
 *      on this page depends on it for a number.
 */
function Narrative({ signals, verdict, hours }: { signals: Signal[]; verdict: string; hours: number }) {
  const n = useNarrative(
    signals.map((s) => ({
      id: s.id,
      title: s.title,
      evidence: s.evidence,
      metric: s.metric,
      source: s.source,
      sev: s.sev
    })),
    verdict,
    hours,
    true
  );

  if (n.state === 'loading')
    return (
      <Generated model="…" meta="reading">
        <div style={{ font: `400 13px/1.55 ${FONT.text}`, color: C.t3 }}>Generating…</div>
      </Generated>
    );

  if (n.state === 'unavailable')
    return (
      <Generated model="-">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <span style={{ color: C.warnText, display: 'flex', flex: 'none' }}>
            <Icon name="exclamationmark.triangle" size={13} />
          </span>
          <span
            style={{
              font: `600 10px/1 ${FONT.text}`,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: C.warnText
            }}
          >
            Narrative unavailable
          </span>
        </div>
        <div style={{ font: `400 13px/1.55 ${FONT.text}`, color: C.t2, maxWidth: '76ch' }}>
          {reasonText(n.reason, n.detail)} The signals below are unaffected - they are measured, not generated.
          Nothing is missing from this page except the prose.
        </div>
      </Generated>
    );

  const d = n.data;
  return (
    <Generated
      model={d.model}
      meta={`${(d.ms / 1000).toFixed(1)}s${d.neurons != null ? ` · ${d.neurons} neurons` : ''}`}
    >
      <p style={{ font: `400 15px/1.6 ${FONT.text}`, color: '#fff', margin: 0, maxWidth: '76ch' }}>{d.narrative}</p>
      {d.citations.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {d.citations.map((c) => (
            <span
              key={c}
              style={{
                padding: '4px 9px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.05)',
                border: LINE.edge,
                font: `400 10.5px/1.4 ${FONT.mono}`,
                color: C.t3
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <div style={{ font: `400 11.5px/1.55 ${FONT.text}`, color: C.t3, marginTop: 14, maxWidth: '76ch' }}>
        Narration only. Every figure above is rendered from the signal it cites, not produced by the model - see the
        panels below for the measured values.
      </div>
    </Generated>
  );
}


/**
 * Who is being served right now.
 *
 * NOT "is the station on air". Rad.FM gives every user their own station and
 * their own DJ - built from what they love, skip and replay - so there is no
 * single transmission to be on or off. This panel first said ON AIR NOW with one
 * track under it, which described a product that does not exist: one broadcast,
 * everyone hearing the same thing.
 *
 * What a control room for THIS product needs is how many people are currently
 * being played to, and a sample across DIFFERENT listeners so the per-user shape
 * is visible on the page rather than implied.
 */
function OnAir({ state, demo }: { state: ReturnType<typeof useOnAir>; demo: boolean }) {
  const eyebrow = (label: string, colour: string, live: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={dot(colour, live)} />
      <span
        style={{ font: `600 9.5px/1 ${FONT.text}`, letterSpacing: '0.18em', textTransform: 'uppercase', color: colour }}
      >
        {label}
      </span>
    </div>
  );

  if (demo) return eyebrow('3 listening now', C.ok, true);
  if (state.state !== 'ok') return eyebrow('Listener activity unavailable', C.warnText, false);

  const { listeners, quietFor, nowPlaying } = state.data;

  // Nobody at all in three hours. Every station is idle, not one of them.
  if (quietFor == null)
    return (
      <>
        {eyebrow('Nobody listening', C.bad, false)}
        <div style={{ font: `400 12.5px/1.5 ${FONT.text}`, color: C.t2, maxWidth: '62ch' }}>
          No plays from any listener in three hours. Nothing throws when nobody is being played to, so no other panel
          here will show it.
        </div>
      </>
    );

  const now = listeners.last30m;
  return (
    <>
      {eyebrow(
        now > 0 ? `${now} listening now` : `Quiet for ${quietFor}m`,
        now > 0 ? C.ok : C.warnText,
        now > 0
      )}
      <div style={{ font: `400 12px/1.5 ${FONT.text}`, color: C.t3, marginBottom: 12 }}>
        {listeners.last3h} in the last 3h · {listeners.last24h} today · each on their own station
      </div>
      {/*
        These rows are the last play per listener within three hours, not a live
        feed. Under a teal "2 listening now" they read correctly. Under an amber
        "Quiet for 30m" they read as two people currently listening, which is the
        opposite of what the line above just said - so the list says which it is.
      */}
      {nowPlaying.length > 0 && (
        <div style={{ display: 'grid', gap: 5 }}>
          <div
            style={{
              font: `600 9px/1 ${FONT.text}`,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: C.t3,
              marginBottom: 3
            }}
          >
            {now > 0 ? 'Playing now' : 'Last heard'}
          </div>
          {nowPlaying.map((t) => (
            <div
              key={t.listener}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', font: `400 12.5px/1.5 ${FONT.text}` }}
            >
              {/* The id, not the email. This is a liveness sample, not a
                  directory, and it renders beside a track someone is listening
                  to right now. */}
              <span style={{ font: `400 11px/1.5 ${FONT.mono}`, color: C.t3, minWidth: 54 }}>user {t.listener}</span>
              <span style={{ color: '#fff' }}>{t.title}</span>
              <span style={{ color: C.t2 }}>{t.artist}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
