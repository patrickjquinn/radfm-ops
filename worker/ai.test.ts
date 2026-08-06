import { describe, expect, it } from 'vitest';
import {
  contentOf,
  cosine,
  findMerges,
  payloadOf,
  redact,
  redactDeep,
  safeParse,
  stripBanned,
  validCitations
} from './ai';

/**
 * Redaction is the control that keeps personal data out of a third party's
 * infrastructure. Cloudflare states it does not train on customer content, but
 * retention is not documented — so anything sent must be assumed to persist
 * somewhere we cannot audit.
 *
 * These tests exist because this cannot be retrofitted. Once an email has been
 * sent to inference it cannot be recalled.
 */
describe('redact', () => {
  it('strips email addresses, which is the one that matters most', () => {
    expect(redact('actor patrick.jm.quinn@gmail.com wrote config')).toBe('actor <email> wrote config');
    expect(redact('a+tag@sub.domain.co.uk failed')).toBe('<email> failed');
  });

  it('strips JWTs, which appear in error text more often than anyone expects', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjN9.abc-DEF_123';
    expect(redact(`bad token ${jwt} rejected`)).toBe('bad token <token> rejected');
  });

  it('strips IPs, so a warning about a rate-limited client is not a location', () => {
    expect(redact('rate-limit /auth/refresh-token ip=192.168.1.44')).toContain('<ip>');
    expect(redact('rate-limit ip=192.168.1.44')).not.toMatch(/192\.168/);
  });

  it('strips user ids in every spelling the logs actually use', () => {
    for (const s of ['user 3', 'userId=412', 'user_id: 9', 'uid#77', 'rc_subscriber_id 3']) {
      expect(redact(`[entitlement] ${s} reconciled`), s).toContain('<uid>');
      expect(redact(`[entitlement] ${s} reconciled`), s).not.toMatch(/\d/);
    }
  });

  it('strips long hex, which is how ids arrive when they are not decimal', () => {
    expect(redact('subscriber b01e1140660d0a36b16f6e98 synced')).toBe('subscriber <hex> synced');
  });

  it('leaves ordinary operational text intact', () => {
    // Over-redaction costs the model context and makes the narrative vaguer, so
    // this is a real constraint and not just a nicety.
    const msg = '[setlists] last.fm fallback failed: The artist you supplied could not be found';
    expect(redact(msg)).toBe(msg);
  });

  it('handles an email containing digits without leaving fragments behind', () => {
    // Ordering bug guard: strip emails BEFORE digit runs, or the digits inside the
    // address match first and the address stops matching at all.
    expect(redact('user3.test@example.com')).toBe('<email>');
  });
});

describe('redactDeep', () => {
  it('reaches strings at every depth, because payloads are nested', () => {
    const out = redactDeep({
      verdict: 'Degraded',
      signals: [{ title: 'x', evidence: 'actor a@b.com hit ip=10.0.0.1', metric: '3' }]
    });
    expect(JSON.stringify(out)).not.toMatch(/a@b\.com|10\.0\.0\.1/);
    expect(out.signals[0].metric).toBe('3');
  });

  it('leaves non-strings alone rather than stringifying them', () => {
    expect(redactDeep({ n: 42, b: true, nil: null })).toEqual({ n: 42, b: true, nil: null });
  });
});

/**
 * A fabricated citation is worse than no citation: it is the exact thing that
 * makes generated prose look accountable when it is not. The model may only cite
 * ids we supplied.
 */
describe('validCitations', () => {
  const allowed = ['signal:4xx-elevated', 'signal:recs-fallback'];

  it('keeps citations we supplied', () => {
    expect(validCitations(['signal:4xx-elevated'], allowed)).toEqual(['signal:4xx-elevated']);
  });

  it('drops an invented id rather than rendering it as provenance', () => {
    expect(validCitations(['signal:4xx-elevated', 'signal:totally-made-up'], allowed)).toEqual([
      'signal:4xx-elevated'
    ]);
  });

  it('dedupes, so one signal cited twice is one chip', () => {
    expect(validCitations(['signal:recs-fallback', 'signal:recs-fallback'], allowed)).toHaveLength(1);
  });

  it('survives the model returning the wrong shape entirely', () => {
    expect(validCitations('signal:4xx-elevated', allowed)).toEqual([]);
    expect(validCitations(undefined, allowed)).toEqual([]);
    expect(validCitations([42, null, {}], allowed)).toEqual([]);
  });
});

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 rather than NaN for a zero vector', () => {
    // A zero vector is what a failed embedding looks like. NaN would compare
    // false against the threshold and silently drop the row instead of failing.
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

/**
 * Clustering may only ever change GROUPING. The totals it reports are plain sums
 * over counts the regex pass already established — arithmetic done in code, never
 * by the model.
 */
describe('findMerges', () => {
  const groups = [
    { msg: 'setlist enrich failed: upstream deadline', count: 900 },
    { msg: 'apple isrc lookup timed out', count: 400 },
    { msg: 'premium check fell back to cache', count: 156 },
    { msg: 'something entirely unrelated', count: 5 }
  ];
  // First three point the same way; the fourth is orthogonal to them.
  const vectors = [
    [1, 0, 0],
    [0.97, 0.24, 0],
    [0.95, 0.31, 0],
    [0, 0, 1]
  ];

  it('merges the groups that mean the same thing and leaves the outlier alone', () => {
    const merges = findMerges(groups, vectors, 0.86);
    expect(merges).toHaveLength(1);
    expect(merges[0].members).toHaveLength(3);
    expect(merges[0].members).not.toContain('something entirely unrelated');
  });

  it('sums the regex pass counts exactly — the model contributes grouping only', () => {
    expect(findMerges(groups, vectors, 0.86)[0].total).toBe(900 + 400 + 156);
  });

  it('reports nothing when the regex pass already agrees', () => {
    // The panel renders only when it has a finding. One that says "no findings"
    // on every load teaches the operator to skip it.
    const distinct = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1]
    ];
    expect(findMerges(groups, distinct, 0.86)).toEqual([]);
  });

  it('ranks the largest merge first, by blast radius like everything else', () => {
    const six = [...groups, { msg: 'x', count: 10 }, { msg: 'y', count: 11 }];
    const vecs = [...vectors, [0, 1, 0], [0, 0.99, 0.1]];
    const merges = findMerges(six, vecs, 0.86);
    expect(merges.length).toBeGreaterThan(1);
    expect(merges[0].total).toBeGreaterThan(merges[1].total);
  });
});

/**
 * Workers AI is not uniform across models on the binding path. Measured live on
 * 6 Aug 2026: llama-3.3 returns `{ response }`, while glm-4.7-flash and gemma-4
 * both return an OpenAI `chat.completion` object.
 *
 * Reading only `.response` therefore worked for one model and returned undefined
 * for the pinned one — the narrative panel failed for a whole deploy cycle
 * because of it. The model id is a Tier 1 value expected to change without a code
 * release, so covering both shapes is not defensive programming, it is the
 * contract.
 */
describe('contentOf', () => {
  it('reads the llama-style { response } shape', () => {
    expect(contentOf({ response: 'hello' })).toBe('hello');
  });

  it('reads the OpenAI chat.completion shape the pinned model returns', () => {
    expect(contentOf({ object: 'chat.completion', choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });

  it('joins multipart content rather than rendering [object Object]', () => {
    expect(contentOf({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] })).toBe('ab');
  });

  it('returns empty string, never undefined, for a shape it does not know', () => {
    expect(contentOf({ weird: true })).toBe('');
    expect(contentOf(null)).toBe('');
  });
});

describe('safeParse', () => {
  it('parses plain JSON', () => {
    expect(safeParse('{"narrative":"x","citations":[]}').narrative).toBe('x');
  });

  it('survives a code fence, which models add unprompted', () => {
    expect(safeParse('```json\n{"narrative":"x"}\n```').narrative).toBe('x');
  });

  it('digs the object out of a sentence of preamble', () => {
    expect(safeParse('Here you go: {"narrative":"x"} hope that helps').narrative).toBe('x');
  });

  it('returns null for genuine prose, so the caller can fall back to it', () => {
    expect(safeParse('The system is fine.')).toBeNull();
  });
});

/**
 * The shape matrix, measured live rather than assumed. Each row here cost a
 * deploy cycle to discover, and the model id is a Tier 1 value that can change
 * without a code release — so this is the contract, not belt-and-braces.
 */
describe('payloadOf', () => {
  it('takes the parsed object when response_format succeeded', () => {
    // The one that caught me out: the field holds an OBJECT, not a JSON string,
    // so a string-only extractor returned empty from a perfectly good answer.
    const { parsed } = payloadOf({ response: { narrative: 'x', citations: ['signal:a'] } });
    expect(parsed.narrative).toBe('x');
    expect(parsed.citations).toEqual(['signal:a']);
  });

  it('parses the JSON string form', () => {
    expect(payloadOf({ response: '{"narrative":"x"}' }).parsed.narrative).toBe('x');
  });

  it('surfaces plain prose as text so the caller can still use it', () => {
    const { parsed, text } = payloadOf({ response: 'All quiet.' });
    expect(parsed).toBeNull();
    expect(text).toBe('All quiet.');
  });

  it('reads the OpenAI choices shape', () => {
    expect(payloadOf({ choices: [{ message: { content: '{"narrative":"y"}' } }] }).parsed.narrative).toBe('y');
  });

  it('yields nothing usable for a reasoner that never wrote content', () => {
    const { parsed, text } = payloadOf({ choices: [{ message: { content: null, reasoning: 'thinking...' } }] });
    expect(parsed).toBeNull();
    expect(text).toBe('');
  });
});

/**
 * The no-verdict rule, enforced in code because the prompt does not hold.
 *
 * Measured live: under a system prompt explicitly banning the words, the model
 * still returned "Despite the current stability" and "operating without major
 * disruptions". A prompt is a request. Everything else in this dashboard puts
 * its guarantees in code, and this is the one place where a generated sentence
 * could contradict a measured value on the same screen.
 */
describe('stripBanned', () => {
  it('removes a verdict claim while keeping the real observation', () => {
    const out = stripBanned(
      'Recommendation fallback is elevated and nothing threw. Despite the current stability, it is worth monitoring.'
    );
    expect(out).toBe('Recommendation fallback is elevated and nothing threw.');
  });

  it('removes every paraphrase of "everything is fine"', () => {
    for (const s of [
      'The system is currently stable.',
      'The system is operating without major disruptions.',
      'Everything looks healthy.',
      'There are no significant issues.',
      'The situation is under control.'
    ]) {
      expect(stripBanned(s), s).toBe('');
    }
  });

  it('removes filler that adds length without information', () => {
    for (const s of [
      'It is worth monitoring the situation.',
      'Keep an eye on this.',
      'This may indicate a potential issue.',
      'Further investigation is warranted.'
    ]) {
      expect(stripBanned(s), s).toBe('');
    }
  });

  it('leaves a genuine finding completely untouched', () => {
    const good =
      'Both open signals trace to the same upstream: the recommender fell back because the pool came back empty, which is also why three requests returned no tracks at all.';
    expect(stripBanned(good)).toBe(good);
  });

  it('returns empty when nothing survives, so the caller can say nothing at all', () => {
    // Saying nothing beats saying something that contradicts the verdict above it.
    expect(stripBanned('The system is stable. It is worth monitoring.')).toBe('');
  });

  it('does not strip a sentence merely for containing a signal word in context', () => {
    // "degraded" describing a MEASURED source is fine; the ban is on the model
    // declaring an overall state. This is the boundary case worth pinning down.
    const s = 'The orchestrator degraded gracefully, so nothing threw.';
    expect(stripBanned(s)).toBe(s);
  });
});
