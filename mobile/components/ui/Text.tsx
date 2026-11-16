/**
 * Text — the type ladder as variants, so screens stop hand-rolling sizes.
 *
 *   display  28/700        screen hero numbers, big totals
 *   serif    30 serif      lowercased screen titles ("my events")
 *   title    20/700        sheet and screen titles (sans)
 *   heading  17/600        card and group titles
 *   body     15/400        running text
 *   label    13/600        row labels, buttons in rows, links
 *   meta     13/400        secondary meta (muted by default)
 *   caption  12/500        tertiary meta (muted by default)
 *   eyebrow  11/600 caps   the ONE eyebrow style
 *   code     13 mono       true identifiers only (ticket ids, order refs)
 *
 * Weights stop at 700. Colour defaults to the theme's primary text; `muted`
 * picks textSecondary, `faint` textTertiary.
 */
import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { font } from '../../theme/tokens';

export type TextVariant =
  | 'display'
  | 'serif'
  | 'title'
  | 'heading'
  | 'body'
  | 'label'
  | 'meta'
  | 'caption'
  | 'eyebrow'
  | 'code';

const VARIANTS: Record<TextVariant, TextStyle> = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.6 },
  serif: { fontFamily: font.serif, fontSize: 30, lineHeight: 36 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  eyebrow: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  code: { fontFamily: font.mono, fontSize: 13, lineHeight: 18 },
};

const MUTED_BY_DEFAULT: ReadonlySet<TextVariant> = new Set(['meta', 'caption', 'eyebrow']);

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  muted?: boolean;
  faint?: boolean;
}

export function Text({ variant = 'body', color, muted, faint, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const ink = color
    ?? (faint ? colors.textTertiary : muted || (muted === undefined && MUTED_BY_DEFAULT.has(variant)) ? colors.textSecondary : colors.text);
  return (
    <RNText
      {...rest}
      accessibilityRole={rest.accessibilityRole ?? (variant === 'serif' || variant === 'title' ? 'header' : undefined)}
      maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? 1.4}
      style={[VARIANTS[variant], { color: ink }, style]}
    />
  );
}

export default Text;
