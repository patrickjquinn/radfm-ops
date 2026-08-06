/**
 * The words this product uses for "we do not have a number", defined once.
 *
 * ISO 9241-112 asks for internal consistency: the same state must be presented
 * the same way everywhere, or the reader has to learn the interface twice. An
 * audit found TWELVE labels in use - unavailable, cannot verify, unverified,
 * Unknown, unpriced, not priced, not checked, none yet, no premium data, per
 * image, Unavailable, Unverified - several of them saying exactly the same
 * thing in different words.
 *
 * The fix is NOT one word for all of them. This dashboard exists because
 * "we could not ask" and "the answer is zero" were once shown identically, and
 * collapsing these would repeat that mistake in the other direction. The five
 * below are genuinely different claims and an operator acts differently on each.
 * Everything outside this list was a synonym and has been folded in.
 */
export const STATE = {
  /** We asked and could not get an answer. Something is wrong, or a scope is missing. */
  unavailable: 'unavailable',

  /** We deliberately did not ask. Nothing is wrong; this call was not made. */
  notChecked: 'not checked',

  /** The system was not recording this at the time. The past cannot be recovered. */
  notRecorded: 'not recorded',

  /** We are recording now and nothing has happened yet. Absence, not failure. */
  noneYet: 'none yet',

  /** We asked, the answer was empty, and empty is not proof either way. */
  unverified: 'unverified'
} as const;

/**
 * Why each state is on screen, in one sentence.
 *
 * ISO 24495-1 asks that readers can USE what they find. A bare label tells an
 * operator what happened; it does not tell them whether to act. These do.
 */
export const STATE_MEANING: Record<keyof typeof STATE, string> = {
  unavailable: 'The source did not answer. This needs looking at.',
  notChecked: 'This call was not made. Nothing is wrong.',
  notRecorded: 'Not being recorded at the time. The past cannot be recovered.',
  noneYet: 'Recording now, nothing has happened yet.',
  unverified: 'Asked, and the answer was empty. Empty is not proof either way.'
};
