/**
 * Design tokens — light and dark variants.
 *
 * The 12 keys used by every themed component are present in both objects
 * with identical names so consumers can swap `T` → `darkTokens` via the
 * ThemeProvider without touching call sites.
 *
 * The dark variant is a "warm earth" dim — same browns/ambers as light,
 * just at low lightness instead of high. Brand identity carries through;
 * no pure-black backgrounds, no cold grays.
 */

export interface TokenShape {
  // Earth palette
  earth1: string;
  earth2: string;
  earth3: string;
  earth4: string;
  earth5: string;
  earth6: string;

  // Brand
  primary: string;
  primaryLight: string;
  primaryDeep: string;

  // Surfaces
  cardBg: string;
  cardBorder: string;
  cardBorderSoft: string;

  // Text
  ink: string;
  inkSoft: string;
  inkMuted: string;

  // Status accents
  accentWarn: string;
  accentAmber: string;
  accentGood: string;

  // Legacy aliases (kept identical so older call sites keep working)
  surface: string;
  surface2: string;
  delight: string;
  warning: string;
  good: string;
  accent: string;
  accentDeep: string;
  bg: string;

  // Background gradient (used by .sage-bg)
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
}

export const lightTokens: TokenShape = {
  earth1: '#3D271D',
  earth2: '#5C3C2E',
  earth3: '#8E674F',
  earth4: '#CBA787',
  earth5: '#E8D4C1',
  earth6: '#FAF4EC',

  primary:        '#3D271D',
  primaryLight:   '#5C3C2E',
  primaryDeep:    '#251610',

  cardBg:        'rgba(255, 248, 240, 0.58)',
  cardBorder:    'rgba(255, 255, 255, 0.75)',
  cardBorderSoft:'rgba(255, 255, 255, 0.45)',

  ink:            '#2C1A11',
  inkSoft:        '#684A37',
  inkMuted:       '#96735B',

  accentWarn:     '#C45B28',
  accentAmber:    '#C87428',
  accentGood:     '#2D7A4F',

  surface:        'rgba(255, 248, 240, 0.65)',
  surface2:       'rgba(240, 222, 204, 0.55)',
  delight:        '#C87428',
  warning:        '#C45B28',
  good:           '#2D7A4F',
  accent:         '#3D271D',
  accentDeep:     '#251610',
  bg:             '#DBBC9E',

  gradientStart:  '#EAD7C4',
  gradientMid:    '#DBBC9E',
  gradientEnd:    '#BA9270',
} as const;

/**
 * Dark variant — mirrors the admin dashboard's dark surface.
 *
 * The admin uses a `linear-gradient(180deg, #1B1411 → #2A201B)` page
 * background with `rgba(255, 255, 255, 0.04)` glass cards, white-on-cream
 * text (`#F9F2E4`), and warm tints for secondary text (`rgba(249, 242,
 * 228, 0.55–0.65)`). We use the exact same recipe so flipping the user
 * PWA into dark mode feels like stepping into the admin tool — same
 * product, same earth identity, just dimmed.
 *
 * The previous warm-brown-glass variant was too distinct from admin; the
 * user asked to align them so the dark UI looks identical to admin.
 */
export const darkTokens: TokenShape = {
  earth1: '#1F1815',
  earth2: '#2A201B',
  earth3: '#3D302A',
  earth4: '#5C4838',
  earth5: '#7A6450',
  earth6: '#F9F2E4',

  primary:        '#D0AE92',
  primaryLight:   '#E8C49A',
  primaryDeep:    '#F2EAE1',

  // Dark card surface: warm dark-earth glass card with contrast border
  cardBg:        'rgba(42, 32, 27, 0.92)',
  cardBorder:    'rgba(255, 255, 255, 0.12)',
  cardBorderSoft:'rgba(255, 255, 255, 0.08)',

  // High-contrast text ramp: crisp cream primary, 78% cream secondary, 60% cream tertiary
  ink:            '#F9F2E4',
  inkSoft:        'rgba(249, 242, 228, 0.78)',
  inkMuted:       'rgba(249, 242, 228, 0.60)',

  accentWarn:     '#F0B79A',
  accentAmber:    '#E8C49A',
  accentGood:     '#B8C68A',

  surface:        'rgba(34, 26, 22, 0.95)',
  surface2:       '#3D302A',
  delight:        '#E8C49A',
  warning:        '#F0B79A',
  good:           '#B8C68A',
  accent:         '#D0AE92',
  accentDeep:     '#EBD7BE',
  bg:             '#1B1411',

  // Admin page gradient (also used by .sage-bg in dark mode).
  gradientStart:  '#1B1411',
  gradientMid:    '#2A201B',
  gradientEnd:    '#1B1411',
} as const;

// ── Active-token reference (mutable, swapped by ThemeProvider) ──────────
//
// The codebase has 237+ call sites reading `T.ink`, `T.cardBg`, etc.
// directly. Rewriting each to call `useTokens()` would be invasive and
// risks subtle bugs. Instead we make `T` (re-exported by `data.ts`) a
// Proxy that reads through this mutable reference, so swapping the
// reference flips every existing `T.foo` site on the next render with
// zero call-site changes.

const initialDocTheme = typeof document !== 'undefined'
  ? document.documentElement.getAttribute('data-theme')
  : null;

/** Mutable pointer to the active token set. Updated by ThemeProvider. */
let _active: TokenShape = initialDocTheme === 'dark' ? darkTokens : lightTokens;

/** Set the active token set. Called by ThemeProvider on every change. */
export function setActiveTokens(tokens: TokenShape): void {
  _active = tokens;
}

/** Read the active token set (for non-React contexts). */
export function getActiveTokens(): TokenShape {
  return _active;
}

/**
 * Proxy token object. `T.ink` looks up `_active.ink` at access time, so
 * when the ThemeProvider swaps `_active` from lightTokens → darkTokens
 * every component's `T.ink` resolves to the dark value on its next
 * render. No re-render is required to *update* the value — the lookup
 * is lazy — but the component still needs to re-render to pick up the
 * new value in its JSX. ThemeProvider triggers that by re-rendering
 * its children whenever `theme` changes.
 */
export const T: TokenShape = new Proxy({} as TokenShape, {
  get(_target, prop: string) {
    return _active[prop as keyof TokenShape];
  },
  has(_target, prop: string) {
    return prop in _active;
  },
  ownKeys() {
    return Reflect.ownKeys(_active);
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    return Object.getOwnPropertyDescriptor(_active, prop);
  },
});