import { BG, C, FONT, LINE, bar, dot, num } from '../theme';
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
        borderRadius: 8,
        padding: '15px 17px',
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
        gap: 1,
        background: 'rgba(255,255,255,0.08)',
        border: LINE.edge,
        borderRadius: 8,
        overflow: 'hidden'
      }}
    >
      {items.map((m) => (
        <div key={m.label} style={{ background: BG.card, padding: '16px 18px 18px' }}>
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

/** Renders the three states so no view has to remember to handle `unavailable`. */
export function Source<T>({
  data,
  what,
  children
}: {
  data: Loaded<T>;
  what: string;
  children: (d: T) => React.ReactNode;
}) {
  if (data.state === 'loading') return <Loading what={what} />;
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
        borderRadius: 12,
        padding: '18px 20px',
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
