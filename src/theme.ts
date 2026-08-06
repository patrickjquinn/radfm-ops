/**
 * Design tokens, lifted verbatim from `Rad.FM Ops.dc.html`.
 *
 * Colour is SEMANTIC, never decorative. Three signal colours plus white
 * opacities: teal means ok or live, amber means degraded, red means failing. A
 * colour on this page always means a state - there is no categorical palette,
 * because a category colour would make "which of these is bad?" unanswerable at
 * a glance, which is the only question this tool exists to answer.
 */
export const C = {
  ok: '#3FB3A6',
  okDim: '#2E6B66',
  warn: '#E0A030',
  warnText: '#E8BC6A',
  bad: '#FF6259',
  badDim: '#8A3029',
  t1: '#fff',
  t2: 'rgba(255,255,255,0.62)',
  /**
   * 0.50, not the 0.38 this shipped with.
   *
   * Design measured it: 0.38 composites to 3.44:1 on #0A0C0D and fails WCAG AA at
   * every size the type scale assigns t3 - provenance meta at 10.5px, stat labels
   * at 9.5px. 0.50 measures 5.37:1 and passes.
   *
   * Worth being blunt about: this is the tier used for PROVENANCE, and provenance
   * is the thing that tells an operator whether to believe a number. Setting it
   * below legibility is not a subtle aesthetic choice, it is hiding the part that
   * makes the rest trustworthy.
   */
  t3: 'rgba(255,255,255,0.50)'
} as const;

export const BG = {
  page: '#0A0C0D',
  side: '#08090A',
  card: '#0C0F10'
} as const;

export const LINE = {
  edge: '1px solid rgba(255,255,255,0.08)',
  row: '1px solid rgba(255,255,255,0.055)'
} as const;

export const FONT = {
  text: "-apple-system,'SF Pro Text',system-ui,'Helvetica Neue',sans-serif",
  display: "-apple-system,'SF Pro Display',system-ui,sans-serif",
  mono: "ui-monospace,'SF Mono',Menlo,monospace"
} as const;

/**
 * Motion means state, never decoration: the dot pulses because something is
 * live. Anything that pulses for visual interest is lying about liveness.
 */
export const dot = (color: string, live = false): React.CSSProperties => ({
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: color,
  flex: 'none',
  display: 'block',
  animation: live ? 'opsPulse 1.8s ease-in-out infinite' : undefined
});

export const bar = (pct: number, color: string): React.CSSProperties => ({
  height: '100%',
  width: `${Math.max(0, Math.min(100, pct))}%`,
  background: color,
  borderRadius: 2
});

/** All numerals are tabular so columns align and a change is readable at a glance. */
export const num: React.CSSProperties = {
  fontFamily: FONT.mono,
  fontVariantNumeric: 'tabular-nums'
};

export const sevColor = (sev: 'bad' | 'warn' | 'info' | 'ok') =>
  sev === 'bad' ? C.bad : sev === 'warn' ? C.warn : sev === 'ok' ? C.ok : 'rgba(255,255,255,0.3)';

/**
 * Depth and motion, borrowed from tvOS.
 *
 * Apple TV builds hierarchy with LAYERS rather than borders: a focused element
 * lifts toward the viewer, everything behind it recedes. This dashboard had one
 * surface treatment repeated - a 1px border and a flat fill - so a verdict, a
 * status card and a table row all carried identical visual weight. Everything
 * looked equally important, which is the same as nothing being important.
 *
 * Three levels, and nothing gets a fourth:
 *   base   the page
 *   raised panels that sit on it
 *   focus  the one thing under the cursor
 */
export const ELEV = {
  raised: {
    background: 'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.012) 100%)',
    border: '1px solid rgba(255,255,255,0.075)',
    boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.7)'
  },
  focus: {
    boxShadow: '0 1px 0 rgba(255,255,255,0.07) inset, 0 16px 40px -14px rgba(0,0,0,0.85)',
    borderColor: 'rgba(255,255,255,0.14)'
  }
} as const;

/**
 * One duration, one curve.
 *
 * 160ms ease-out: fast enough to feel like a response rather than an animation,
 * slow enough to read as movement. tvOS moderates motion deliberately - things
 * settle, they do not bounce - and a dashboard is read, not played with.
 * `prefers-reduced-motion` disables all of it in styles.css.
 */
export const MOTION = '150ms cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * The tvOS focus effect, to spec rather than by impression.
 *
 * Apple's is a slight SCALE plus a SHADOW LIFT plus the platform's standard
 * timing: roughly 1.05-1.1x over about 0.15s, ease-in-out. What I shipped first
 * changed a background colour and called itself a focus effect, which is not the
 * effect - the whole point is that the focused thing rises toward the viewer.
 *
 * 1.012 here, not 1.1. A television is viewed from three metres with a remote
 * and one item focused at a time; this is a dense dashboard read from fifty
 * centimetres with a pointer. At 1.1 a row would shove its neighbours around on
 * every mouse move. The principle transfers, the magnitude does not, and copying
 * the number instead of the intent would be cargo-culting the platform.
 *
 * It deliberately does NOT touch `background`. The first version returned
 * `background: undefined` in the resting state, which spread over the caller's
 * own fill and removed it - the hairline behind a grid then showed through every
 * cell and the whole strip rendered washed out. A helper that silently clears a
 * property the caller set is a trap; this one only ever sets the two things a
 * focus effect is actually made of.
 */
export const focusLift = (on: boolean): React.CSSProperties => ({
  transform: on ? 'scale(1.012)' : 'scale(1)',
  boxShadow: on ? '0 12px 32px -10px rgba(0,0,0,0.8)' : '0 0 0 rgba(0,0,0,0)',
  transition: `transform ${MOTION}, box-shadow ${MOTION}, background ${MOTION}`
});

/**
 * A change, with its direction.
 *
 * Every number on the Overview was absolute: 160 4xx, 418 plays, 18
 * subscriptions. None of them said whether that was better or worse than
 * yesterday, which is the first thing anyone actually wants to know.
 *
 * Returns null when there is no comparable prior period. A delta against a
 * window that did not exist is the false-zero mistake wearing an arrow.
 */
export function delta(now: number | null, before: number | null) {
  if (now == null || before == null || before === 0) return null;
  const pct = ((now - before) / before) * 100;
  return { pct, up: pct > 0, text: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%` };
}
