/**
 * The recommender's scoring weights, transcribed from the backend source.
 *
 * NOT read from the running system. There is no route that serves them, so this
 * is a transcription of `rad-fm-backend/src/rad/constants` and it can drift the
 * moment someone edits that file. Every panel that shows these must say so.
 *
 * Kept rather than deleted because the design puts them beside the outcome
 * metrics deliberately - a weight change you cannot see next to its effect is
 * worse than one you can. But "from source" and "from the running system" are
 * different claims, and this dashboard does not get to blur them.
 */
export const WEIGHTS_SOURCE = 'rad-fm-backend/src/rad/constants';
export const weights = [
  { name: 'W_ENERGY', value: '0.28' },
  { name: 'W_HARMONIC', value: '0.20' },
  { name: 'W_VALENCE', value: '0.18' },
  { name: 'W_ACOUSTIC', value: '0.17' },
  { name: 'W_TEMPO', value: '0.17' }
];
