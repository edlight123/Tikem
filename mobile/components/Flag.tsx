import React, { memo } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { FLAG_SVGS } from '../data/flagSvgs';

/** ISO-2 country code to its flag emoji ("US" -> regional indicators U+S). */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * A round country flag (bundled SVG, ported from Tikra 2026-11-24), with a
 * soft inner ring so light flags still have an edge on the black canvas.
 * Round like an avatar (the one exception to the 4px rule). Falls back to the
 * emoji for a code we have no drawing for.
 */
function FlagBase({ code, size = 24, style }: { code: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const iso = String(code || '').toUpperCase();
  const xml = FLAG_SVGS[iso];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.06)',
        },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {xml ? (
        <SvgXml xml={xml} width={size} height={size} />
      ) : (
        <Text style={{ fontSize: size * 0.8, lineHeight: size }}>{flagEmoji(iso)}</Text>
      )}
      {/* Inner ring: a soft edge, not an outline. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 0.75, borderColor: 'rgba(255,255,255,0.12)' }}
      />
    </View>
  );
}

export const Flag = memo(FlagBase);
export default Flag;
