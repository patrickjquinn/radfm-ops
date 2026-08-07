import { useState } from 'react';
import { BG, C, CARD, FONT, GAP, LINE, MOTION, bar, dot, num } from '../theme';
import { Icon } from '../icons';
import { reasonText, type Loaded } from '../lib/api';

/** Section header: a label and, always, where the number came from. */
export function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        paddingBottom: 11,
        borderBottom: LINE.edge
      }}
    >
      <h2
        style={{
          margin: 0,
          font: `600 10px/1 ${FONT.text}`,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.5)'
        }}
      >
        {title}
      </h2>
      {/* Provenance on every panel. These sources are not equally trustworthy
          and the UI must not flatten that. */}
      {meta && <div style={{ font: `400 10.5px/1 ${FONT.mono}`, color: C.t3 }}>{meta}</div>}
    </div>
  );
}

export function Prose({ children, max = 76 }: { children: React.ReactNode; max?: number }) {
  return (
    <p
      style={{
        margin: 0,
        font: `400 12px/1.55 ${FONT.text}`,
        color: 'rgba(255,255,255,0.45)',
        maxWidth: `${max}ch`
      }}
    >
      {children}
    </p>
  );
}

export function Callout({
  tone,
  icon,
  children
}: {
  tone: 'teal' | 'amber' | 'neutral';
  icon?: boolean;
  children: React.ReactNode;
}) {
  const border =
    tone === 'teal' ? 'rgba(63,179,166,0.24)' : tone === 'amber' ? 'rgba(224,160,48,0.24)' : 'rgba(255,255,255,0.09)';
  const bg =
    tone === 'teal' ? 'rgba(63,179,166,0.05)' : tone === 'amber' ? 'rgba(224,160,48,0.05)' : 'rgba(255,255,255,0.02)';
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        background: bg,
        borderRadius: 16,
        padding: '17px 20px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start'
      }}
    >
      {icon && (
        <span style={{ color: tone === 'teal' ? C.ok : C.warnText, marginTop: 2, flex: 'none' }}>
          <Icon name="exclamationmark.triangle" size={14} />
        </span>
      )}
      <div style={{ font: `400 12.5px/1.55 ${FONT.text}`, color: 'rgba(255,255,255,0.72)', maxWidth: '82ch' }}>
        {children}
      </div>
    </div>
  );
}

export type Tone = 'plain' | 'ok' | 'warn' | 'bad' | 'dim';
export const toneColor = (t: Tone) =>
  t === 'ok' ? C.ok : t === 'warn' ? C.warn : t === 'bad' ? C.bad : t === 'dim' ? C.t2 : C.t1;

/** The bordered stat strip used on Overview, Traffic and Recommendations. */
export function StatGrid({
  items,
  min = 190
}: {
  items: { label: string; value: string; context: string; tone: Tone }[];
  min?: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit,minmax(min(100%,${min}px),1fr))`,
        // Separate cards, real gaps. This was one bordered box of cells divided
        // by hairlines, which reads as a table rather than as objects.
        gap: GAP
      }}
    >
      {items.map((m) => (
        <div key={m.label} style={{ ...CARD, padding: '18px 20px 20px' }}>
          <div
            style={{
              font: `600 9.5px/1 ${FONT.text}`,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.45)',
              marginBottom: 12
            }}
          >
            {m.label}
          </div>
          <div style={{ ...num, font: `500 24px/1 ${FONT.mono}`, letterSpacing: '-0.01em', color: toneColor(m.tone) }}>
            {m.value}
          </div>
          <div style={{ font: `400 11px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.42)', marginTop: 7 }}>
            {m.context}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <div style={bar(pct, color)} />
    </div>
  );
}

export function Dot({ color, live = false }: { color: string; live?: boolean }) {
  return <span style={dot(color, live)} />;
}

/**
 * The standard "we could not ask" block.
 *
 * Deliberately not an error toast and not an empty chart: it names the source,
 * says why, and where possible says what to do about it. An operator at 3am
 * needs the reason, not a spinner that never resolves.
 */
export function Unavailable({ reason, detail, what }: { reason: string; detail?: string; what: string }) {
  return (
    <div style={{ padding: '22px 0', display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: C.warnText }}>
        <Icon name="exclamationmark.triangle" size={13} />
        <span
          style={{
            font: `600 10px/1 ${FONT.text}`,
            letterSpacing: '0.14em',
            textTransform: 'uppercase'
          }}
        >
          {what} unavailable
        </span>
      </div>
      <div style={{ font: `400 12.5px/1.6 ${FONT.text}`, color: 'rgba(255,255,255,0.62)', maxWidth: '74ch' }}>
        {reasonText(reason, detail)}
      </div>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div style={{ padding: '22px 0', font: `400 12.5px/1.5 ${FONT.text}`, color: 'rgba(255,255,255,0.5)' }}>
      Reading {what}…
    </div>
  );
}

/* ── Loading skeletons ──────────────────────────────────────────────────────
 *
 * Placeholders shaped like the thing that is coming, rather than one line of
 * text that every panel then jumps out of. A cold load used to move every row
 * on the page twice - once when the text appeared and once when it was replaced
 * by a table of a completely different height - and on a dashboard you open
 * because something is wrong, a layout that jumps while you are reading it is
 * its own small hazard.
 *
 * Two rules these must not break:
 *
 *   NEVER a number. Not a zero, not a dash, not a plausible-looking figure at
 *   low opacity. This product's entire premise is that a shown number is a
 *   measured number, and a skeleton digit is a number that means nothing.
 *
 *   NEVER a severity colour. A placeholder cannot be allowed to imply healthy
 *   or failing before there is a value to justify it.
 */

/** One shimmering block. Width may be a number (px) or any CSS length. */
export function Skel({ w, h = 12, r }: { w: number | string; h?: number; r?: number }) {
  return (
    <span
      className="skel"
      aria-hidden="true"
      style={{ display: 'block', width: typeof w === 'number' ? `${w}px` : w, height: h, borderRadius: r }}
    />
  );
}

/**
 * The announcement, kept off screen.
 *
 * Swapping "Reading X…" for boxes must not take the message away from anyone
 * using a screen reader - the boxes are aria-hidden, so without this the panel
 * would go silent rather than say it is working.
 */
function SkelRegion({ what, children }: { what: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap'
        }}
      >
        Reading {what}…
      </span>
      {children}
    </div>
  );
}

/** Stands in for `StatGrid`: same card, same padding, same three stacked lines. */
export function SkelStats({ n = 4, min = 190 }: { n?: number; min?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit,minmax(min(100%,${min}px),1fr))`,
        gap: GAP
      }}
    >
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ ...CARD, padding: '18px 20px 20px' }}>
          <div style={{ marginBottom: 12 }}>
            <Skel w={72} h={9} />
          </div>
          {/* Matches the 24px figure line, so nothing shifts when the number lands. */}
          <Skel w={96} h={24} r={6} />
          <div style={{ marginTop: 7 }}>
            <Skel w="60%" h={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Stands in for a table body: same 11px vertical padding and same row rule, so
 * the rows do not move when the real ones arrive.
 *
 * `cols` are widths in the order the real table uses them. A `null` entry is the
 * flexible column; everything else is a fixed right-hand column.
 */
export function SkelRows({ rows = 6, cols = [null, 80, 110] }: { rows?: number; cols?: (number | null)[] }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: LINE.row, alignItems: 'center' }}
        >
          {cols.map((c, j) =>
            c == null ? (
              // Varied widths: a column of identical bars reads as a loading bar,
              // not as rows of different content.
              <span key={j} style={{ flex: 1, minWidth: 0 }}>
                <Skel w={`${52 + ((i * 37) % 44)}%`} h={12} />
              </span>
            ) : (
              <span key={j} style={{ width: c, flex: 'none', display: 'flex', justifyContent: 'flex-end' }}>
                <Skel w={c - 14} h={12} />
              </span>
            )
          )}
        </div>
      ))}
    </>
  );
}

/** Stands in for the label + count + `Bar` rows used by Listening, Growth and Rad. */
export function SkelBars({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ padding: '10px 0', borderBottom: LINE.row }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 7 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <Skel w={`${46 + ((i * 29) % 40)}%`} h={12} />
            </span>
            <Skel w={38} h={12} />
          </div>
          <Skel w={`${90 - i * 11}%`} h={3} r={2} />
        </div>
      ))}
    </>
  );
}

/** Stands in for `KeyRow` lists: label left, value right, no bar. */
export function SkelKeyRows({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderBottom: LINE.row }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <Skel w={`${40 + ((i * 23) % 34)}%`} h={12} />
          </span>
          <Skel w={54} h={13} />
        </div>
      ))}
    </>
  );
}

/**
 * Renders the three states so no view has to remember to handle `unavailable`.
 *
 * `skeleton` is what loading looks like. It is optional and falls back to the
 * old text line, deliberately: a panel with no skeleton yet degrades to "Reading
 * X…" rather than to a wrong-shaped placeholder, and a wrong-shaped skeleton is
 * worse than none - it promises a layout that then rearranges.
 *
 * Loading and unavailable stay strictly separate. A skeleton means "the answer
 * is coming"; if the source fails it must become the block that names the source
 * and the reason, never a placeholder that shimmers forever.
 */
export function Source<T>({
  data,
  what,
  skeleton,
  children
}: {
  data: Loaded<T>;
  what: string;
  skeleton?: React.ReactNode;
  children: (d: T) => React.ReactNode;
}) {
  if (data.state === 'loading')
    return skeleton ? <SkelRegion what={what}>{skeleton}</SkelRegion> : <Loading what={what} />;
  if (data.state === 'unavailable')
    return <Unavailable what={what} reason={data.reason} detail={data.detail} />;
  return <>{children(data.data)}</>;
}

/** Disabled controls state their reason rather than being hidden. */
export function ActionButton({
  label,
  allowed,
  why,
  onClick
}: {
  label: string;
  allowed: boolean;
  why: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!allowed}
      aria-disabled={!allowed}
      title={allowed ? '' : why}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 32,
        padding: '0 13px',
        borderRadius: 6,
        font: `500 12px/1 ${FONT.text}`,
        background: allowed ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)',
        border: `1px solid ${allowed ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.07)'}`,
        color: allowed ? '#fff' : 'rgba(255,255,255,0.28)',
        cursor: allowed ? 'pointer' : 'not-allowed'
      }}
    >
      {label}
    </button>
  );
}

/**
 * The wrapper every piece of generated content lives in.
 *
 * Distinguished by TEXTURE, not by colour - a hatched surface, a dashed border and
 * an explicit GENERATED chip. Colour in this product is fully committed to
 * severity: teal means healthy, amber degraded, red failing. Adding a fourth hue
 * for "written by a model" would break the one rule that lets an operator answer
 * "which of these is bad?" at a glance, and would imply that generated is its own
 * kind of state. It is not. It is a different kind of PROVENANCE, which is why it
 * reads as a surface treatment and carries its model id like any other source.
 */
export function Generated({
  model,
  meta,
  children
}: {
  model: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px dashed rgba(255,255,255,0.16)',
        borderRadius: 16,
        padding: '20px 22px',
        background: 'repeating-linear-gradient(135deg,rgba(255,255,255,0.022) 0 6px,transparent 6px 12px)'
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 9px',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.07)',
            border: '1px dashed rgba(255,255,255,0.28)',
            font: `600 9px/1 ${FONT.text}`,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: C.t2
          }}
        >
          Generated
        </span>
        <span style={{ font: `400 10.5px/1 ${FONT.mono}`, color: C.t3 }}>{model}</span>
        <span style={{ flex: 1 }} />
        {meta && <span style={{ font: `400 10.5px/1 ${FONT.mono}`, color: C.t3 }}>{meta}</span>}
      </div>
      {children}
    </div>
  );
}

/** A row in the ranked lists: label, value, note. */
export function KeyRow({
  label,
  value,
  note,
  color = C.t1
}: {
  label: string;
  value: string;
  note?: string;
  color?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '11px 0', borderBottom: LINE.row }}>
      <span style={{ flex: 1, minWidth: 0, font: `400 13px/1.4 ${FONT.text}`, color: C.t2 }}>{label}</span>
      {/* The number is the content; the label is chrome. Size says which. */}
      <span style={{ ...num, font: `500 15px/1.2 ${FONT.mono}`, letterSpacing: '-0.01em', color }}>{value}</span>
      {note !== undefined && (
        <span
          style={{
            width: 96,
            textAlign: 'right',
            font: `400 11px/1.4 ${FONT.text}`,
            color: 'rgba(255,255,255,0.5)'
          }}
        >
          {note}
        </span>
      )}
    </div>
  );
}

/**
 * Show the head of a long list, keep the tail one click away.
 *
 * Shneiderman's mantra for information-seeking - overview first, zoom and
 * filter, details on demand - and the practical reason at 3am: a table of forty
 * warning groups is not forty pieces of information, it is one piece of
 * information and thirty-nine rows of noise. The rows are ranked, so the answer
 * is almost always in the first few.
 *
 * The count of what is hidden is always shown. A list that quietly truncates
 * makes a partial view look complete, which is the same failure as a total that
 * is really a top-N - and this dashboard has already shipped that bug once.
 */
export function Collapsible<T>({
  rows,
  initial = 6,
  render,
  noun
}: {
  rows: T[];
  initial?: number;
  render: (row: T, i: number) => React.ReactNode;
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const hidden = rows.length - initial;
  const shown = open ? rows : rows.slice(0, initial);

  return (
    <>
      {shown.map(render)}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.t1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.t3)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '12px 0',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            font: `400 12px/1 ${FONT.mono}`,
            color: C.t3,
            transition: `color ${MOTION}`
          }}
        >
          {/*
            "more" only makes sense when some are already on screen. With
            initial={0} the list starts closed and "100 more raw error lines"
            reads as a second hundred hiding behind the first.
          */}
          {open ? `Show fewer` : initial === 0 ? `Show ${hidden} ${noun}` : `${hidden} more ${noun}`}
          <span style={{ display: 'flex', transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: `transform ${MOTION}` }}>
            <Icon name="chevron.right" size={10} />
          </span>
        </button>
      )}
    </>
  );
}

/**
 * A titled panel. Every section on every view is one of these.
 *
 * Sections were bare: a SectionHead with a hairline under it, then rows sitting
 * directly on the page. Against the carded Overview that read as unfinished, and
 * more importantly it gave the eye nothing to group by - a view was one long
 * column of rules rather than a set of things.
 *
 * One component so the card treatment cannot drift view by view, which is how it
 * drifted in the first place.
 */
export function Panel({
  title,
  meta,
  children,
  pad = true
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <section style={{ ...CARD, padding: pad ? 'clamp(16px,1.8vw,22px)' : 0 }}>
      <div style={{ padding: pad ? 0 : 'clamp(16px,1.8vw,22px) clamp(16px,1.8vw,22px) 0' }}>
        <SectionHead title={title} meta={meta} />
      </div>
      <div style={{ padding: pad ? 0 : '0 clamp(16px,1.8vw,22px) clamp(8px,1vw,12px)' }}>{children}</div>
    </section>
  );
}
