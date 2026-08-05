import { useState } from 'react';
import type { Ctx } from '../App';
import { C, FONT, LINE, num } from '../theme';
import { Icon } from '../icons';
import { Prose, SectionHead, Source } from '../components/primitives';
import { useStations, type Station } from '../lib/api';

/**
 * Stations Plus browser — Phase 3, read-only.
 *
 * Not a leaderboard. All 341 stations are user-generated and subscriber counts
 * sit at roughly one each, so ranking them by popularity would invent a signal
 * that is not there. It is a content browser: find the station someone is asking
 * about, and see the orphans worth cleaning up in R2.
 */
export default function Stations({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const stations = useStations(submitted, !demo);

  const rows: Station[] = demo ? DEMO_STATIONS : [];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(term.trim());
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
          maxWidth: 520
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.45)', display: 'flex' }}>
          <Icon name="magnifyingglass" size={15} />
        </span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="station name, mood or genre"
          aria-label="Find a station"
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

      <section>
        <SectionHead title="Stations" meta="D1 · stations ⋈ user_stations" />
        <Head />
        {demo ? (
          <Rows rows={rows} />
        ) : (
          <Source data={stations} what="Stations">
            {(d) => (d.stations.length ? <Rows rows={d.stations} /> : <Empty text="No stations matched." />)}
          </Source>
        )}
        <div style={{ paddingTop: 14 }}>
          <Prose>
            A station with no subscribers is an orphan: its artwork is still occupying R2 and nothing
            references it. They are the cleanup candidates, not a failure.
          </Prose>
        </div>
      </section>
    </div>
  );
}

const cols = [
  { label: 'Name', w: undefined as number | undefined },
  { label: 'Mood', w: 120 },
  { label: 'Created', w: 96 },
  { label: 'Subs', w: 64 }
];

function Head() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '10px 0',
        borderBottom: LINE.row,
        font: `600 9.5px/1 ${FONT.text}`,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.38)'
      }}
    >
      {cols.map((c) => (
        <span key={c.label} style={c.w ? { width: c.w, textAlign: 'right' } : { flex: 1, minWidth: 0 }}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function Rows({ rows }: { rows: Station[] }) {
  return (
    <>
      {rows.map((s) => {
        const orphan = Number(s.subscribers) === 0;
        return (
          <div key={s.id} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'baseline' }}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span
                style={{
                  font: `400 12.5px/1.4 ${FONT.text}`,
                  color: 'rgba(255,255,255,0.85)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {s.name}
              </span>
              {/* Orphan status is a word, not just a dim number. Colour alone would
                  be unreadable for anyone who cannot separate the two greys. */}
              {orphan && (
                <span
                  style={{
                    flex: 'none',
                    padding: '1px 6px',
                    borderRadius: 4,
                    font: `500 10px/1.5 ${FONT.mono}`,
                    background: 'rgba(224,160,48,0.14)',
                    color: C.warnText
                  }}
                >
                  orphan
                </span>
              )}
            </span>
            <span
              style={{
                width: 120,
                textAlign: 'right',
                font: `400 11.5px/1.2 ${FONT.mono}`,
                color: 'rgba(255,255,255,0.5)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {s.mood ?? '—'}
            </span>
            <span style={{ width: 96, textAlign: 'right', font: `400 11.5px/1.2 ${FONT.mono}`, color: 'rgba(255,255,255,0.4)' }}>
              {(s.created_at ?? '').slice(0, 10) || '—'}
            </span>
            <span style={{ ...num, width: 64, textAlign: 'right', font: `400 12.5px/1.2 ${FONT.mono}`, color: orphan ? C.warnText : C.t2 }}>
              {s.subscribers}
            </span>
          </div>
        );
      })}
    </>
  );
}

const Empty = ({ text }: { text: string }) => (
  <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>{text}</div>
);

/** Shapes only — the live counts are 341 stations, all user-generated, ~1 sub each. */
const DEMO_STATIONS: Station[] = [
  { id: 'st_8f21', name: 'Rainy Sunday Soul', mood: 'mellow', genres: 'soul, r&b', created_at: '2026-08-02', subscribers: 1, is_user_generated: 1 },
  { id: 'st_71ce', name: 'Late Desk Focus', mood: 'focused', genres: 'ambient', created_at: '2026-08-01', subscribers: 1, is_user_generated: 1 },
  { id: 'st_2ab9', name: 'Basement Indie 2011', mood: 'nostalgic', genres: 'indie rock', created_at: '2026-07-30', subscribers: 0, is_user_generated: 1 },
  { id: 'st_6d40', name: 'Kitchen Disco', mood: 'upbeat', genres: 'disco, funk', created_at: '2026-07-28', subscribers: 2, is_user_generated: 1 },
  { id: 'st_1f77', name: 'Night Drive North', mood: 'driving', genres: 'synthwave', created_at: '2026-07-27', subscribers: 0, is_user_generated: 1 }
];
