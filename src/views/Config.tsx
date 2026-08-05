import { useState } from 'react';
import type { Ctx } from '../App';
import { C, FONT, LINE, num } from '../theme';
import { Icon } from '../icons';
import { Callout, SectionHead } from '../components/primitives';
import { reasonText, useConfig, useSetConfig, type ConfigEntry } from '../lib/api';
import * as fx from '../lib/fixtures';

/**
 * Tier 1 runtime config.
 *
 * Editing is capability-gated on THREE things, all of which must hold:
 *
 *   1. The backend serves GET /admin/config. Until it does, this view shows the
 *      code-side defaults and the design's disabled Edit control, unchanged.
 *   2. The caller is `operator` or above, resolved server-side per request.
 *   3. The backend accepts the PUT — the role check that matters is the one on
 *      that handler, not this one. What is below only decides what to render.
 *
 * The value shown says whether it came from KV or from the constant in code. A
 * config system that cannot tell you which is worse than no config system,
 * because "100" looks identical whether someone set it or nobody ever has.
 */
export default function Config({ ctx }: { ctx: Ctx }) {
  const demo = ctx.demo;
  const config = useConfig(!demo);
  const backendServesConfig = config.state === 'ok';

  const entries: ConfigEntry[] = demo
    ? fx.tier1.map((c) => ({ ...c, source: 'default' as const, default: c.value, location: c.loc }))
    : config.state === 'ok'
      ? config.data.values
      : fx.tier1.map((c) => ({ ...c, source: 'default' as const, default: c.value, location: c.loc }));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Callout tone="neutral">
        Tier 1 values read from <code style={{ font: `400 12px/1 ${FONT.mono}`, color: '#7BCFC5' }}>config:&lt;key&gt;</code>{' '}
        KV through a helper with a hard-coded default. A missing or malformed value falls back to the constant in code,
        never to zero — a config system that fails to an empty value is worse than no config system.
      </Callout>

      {!demo && !backendServesConfig && (
        <div
          style={{
            border: '1px solid rgba(224,160,48,0.24)',
            background: 'rgba(224,160,48,0.05)',
            borderRadius: 8,
            padding: '15px 17px',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start'
          }}
        >
          <span style={{ color: C.warnText, marginTop: 2, flex: 'none', display: 'flex' }}>
            <Icon name="exclamationmark.triangle" size={14} />
          </span>
          <div style={{ font: `400 12.5px/1.55 ${FONT.text}`, color: 'rgba(255,255,255,0.72)', maxWidth: '82ch' }}>
            {config.state === 'unavailable' ? reasonText(config.reason, config.detail) : 'Reading config…'}{' '}
            The values below are the constants in code, shown as a reference. They are <strong style={{ fontWeight: 500, color: '#fff' }}>not</strong>{' '}
            confirmed to be what the running Worker is using.
          </div>
        </div>
      )}

      <section>
        <SectionHead title="Tier 1 · runtime editable" meta="audited on write" />
        {entries.map((c) => (
          <Row
            key={c.key}
            entry={c}
            editable={backendServesConfig && ctx.can.operate}
            why={!backendServesConfig ? 'Phase 4 — the backend config route is not built yet' : 'Requires operator'}
          />
        ))}
      </section>

      <section>
        <SectionHead title="Tier 2 · read-only, change via PR" />
        <div style={{ font: `400 12.5px/1.6 ${FONT.text}`, color: 'rgba(255,255,255,0.5)', padding: '12px 0', maxWidth: '80ch' }}>
          The recommendation weights are a tuned system, not independent dials, and they are meant to sum sensibly. They
          live on the Recommendations view next to the outcome metrics, so a change can be seen rather than guessed.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {fx.weights.map((w) => (
            <div
              key={w.name}
              style={{
                padding: '9px 13px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                border: LINE.edge,
                display: 'flex',
                alignItems: 'baseline',
                gap: 10
              }}
            >
              <span style={{ font: `400 11.5px/1 ${FONT.mono}`, color: 'rgba(255,255,255,0.55)' }}>{w.name}</span>
              <span style={{ ...num, font: `500 12.5px/1 ${FONT.mono}`, color: C.ok }}>{w.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHead title="Tier 3 · not exposed" />
        <div style={{ font: `400 12.5px/1.6 ${FONT.text}`, color: 'rgba(255,255,255,0.5)', paddingTop: 12, maxWidth: '80ch' }}>
          Prompt pools and exemplars are version-controlled creative assets with a test suite asserting their properties.
          Editing them through a web form loses review, loses history, and loses the tests. They are deliberately absent
          from this UI rather than disabled in it.
        </div>
      </section>
    </div>
  );
}

function Row({ entry, editable, why }: { entry: ConfigEntry; editable: boolean; why: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(entry.value));
  const save = useSetConfig();

  const fromKv = entry.source === 'kv';

  return (
    <div style={{ padding: '12px 0', borderBottom: LINE.row }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ font: `400 12.5px/1.4 ${FONT.mono}`, color: 'rgba(255,255,255,0.85)' }}>{entry.key}</div>
          <div style={{ font: `400 11px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
            {entry.location}
            {fromKv && entry.updatedBy ? ` · set by ${entry.updatedBy}` : ''}
          </div>
        </div>

        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ key: entry.key, value: draft.trim() }, { onSuccess: () => setEditing(false) });
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              aria-label={`New value for ${entry.key}`}
              style={{
                width: 96,
                height: 30,
                padding: '0 9px',
                borderRadius: 6,
                textAlign: 'right',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(63,179,166,0.4)',
                color: '#fff',
                font: `500 12.5px/1 ${FONT.mono}`
              }}
            />
            <IconButton label="Save" icon="save" tone="ok" disabled={save.isPending} />
            <IconButton
              label="Cancel"
              icon="close"
              tone="dim"
              disabled={save.isPending}
              onClick={() => {
                setDraft(String(entry.value));
                setEditing(false);
              }}
            />
          </form>
        ) : (
          <>
            <span style={{ ...num, font: `500 13px/1.2 ${FONT.mono}`, color: '#fff', minWidth: 70, textAlign: 'right' }}>
              {String(entry.value)}
            </span>
            {/* Which source the number came from, always. "100" looks the same
                whether someone set it or nobody ever has. */}
            <span
              style={{
                width: 62,
                textAlign: 'right',
                font: `400 10.5px/1.2 ${FONT.mono}`,
                color: fromKv ? C.ok : 'rgba(255,255,255,0.3)'
              }}
              title={fromKv ? `Overridden in KV; code default is ${entry.default}` : 'No KV override — this is the constant in code'}
            >
              {fromKv ? 'kv' : 'default'}
            </span>
            <button
              type="button"
              disabled={!editable}
              aria-disabled={!editable}
              title={editable ? '' : why}
              onClick={() => setEditing(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 30,
                padding: '0 12px',
                borderRadius: 6,
                flex: 'none',
                font: `500 11.5px/1 ${FONT.text}`,
                background: editable ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)',
                border: `1px solid ${editable ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.07)'}`,
                color: editable ? '#fff' : 'rgba(255,255,255,0.28)',
                cursor: editable ? 'pointer' : 'not-allowed'
              }}
            >
              Edit
            </button>
          </>
        )}
      </div>

      {save.isError && (
        <div style={{ font: `400 11.5px/1.5 ${FONT.text}`, color: C.bad, paddingTop: 8, maxWidth: '74ch' }}>
          {reasonText((save.error as any)?.reason ?? 'error', (save.error as any)?.detail)}
        </div>
      )}
      {fromKv && entry.default !== entry.value && !editing && (
        <div style={{ font: `400 11px/1.5 ${FONT.mono}`, color: 'rgba(255,255,255,0.3)', paddingTop: 6 }}>
          code default {String(entry.default)} — this override is what the Worker is using
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  icon,
  tone,
  disabled,
  onClick
}: {
  label: string;
  icon: 'save' | 'close';
  tone: 'ok' | 'dim';
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 6,
        background: tone === 'ok' ? 'rgba(63,179,166,0.16)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${tone === 'ok' ? 'rgba(63,179,166,0.35)' : 'rgba(255,255,255,0.1)'}`,
        color: tone === 'ok' ? C.ok : 'rgba(255,255,255,0.55)',
        cursor: disabled ? 'wait' : 'pointer'
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}
