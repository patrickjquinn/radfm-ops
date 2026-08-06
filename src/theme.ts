/**
 * Design tokens, lifted verbatim from `Rad.FM Ops.dc.html`.
 *
 * Colour is SEMANTIC, never decorative. Three signal colours plus white
 * opacities: teal means ok or live, amber means degraded, red means failing. A
 * colour on this page always means a state — there is no categorical palette,
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
   * every size the type scale assigns t3 — provenance meta at 10.5px, stat labels
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
