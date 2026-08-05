import {
  Activity,
  Catalog,
  Checkmark,
  ChevronRight,
  Close,
  Dashboard,
  Edit,
  Microphone,
  Playlist,
  Radio,
  Renew,
  Save,
  Search,
  SettingsAdjust,
  UserAvatar,
  WarningAlt
} from '@carbon/icons-react';

/**
 * Icons, from IBM Carbon.
 *
 * The prototype referenced two PNG sets — `glyphs_3x` and `glyphs_teal` — because
 * it could not tint a bitmap. Carbon's components render `fill="currentColor"`,
 * so the active/inactive tint is a colour change on the parent rather than a
 * second copy of every asset: same shapes at every DPI, half the files.
 *
 * The names on the left are the SF Symbols the design asked for, kept as the
 * public API so views read against the design rather than against Carbon's
 * vocabulary. Changing an icon means changing one line here.
 */
const MAP = {
  'square.grid.2x2': Dashboard,
  waveform: Activity,
  'line.horizontal.3': Catalog,
  'mic.fill': Microphone,
  'dot.radiowaves.left.and.right': Radio,
  'person.crop.circle': UserAvatar,
  'slider.horizontal.3': SettingsAdjust,
  checkmark: Checkmark,
  'chevron.right': ChevronRight,
  magnifyingglass: Search,
  'exclamationmark.triangle': WarningAlt,
  // Not in the original design: the stations browser, the config editor controls.
  playlist: Playlist,
  edit: Edit,
  save: Save,
  close: Close,
  renew: Renew
} as const;

export type IconName = keyof typeof MAP;

export function Icon({
  name,
  size = 16,
  style
}: {
  name: IconName;
  size?: number;
  style?: React.CSSProperties;
}) {
  const Glyph = MAP[name];
  return (
    <Glyph
      size={size}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none', fill: 'currentColor', ...style }}
    />
  );
}
