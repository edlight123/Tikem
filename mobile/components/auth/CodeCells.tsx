import React, { forwardRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../../theme/tokens';

export const CODE_LENGTH = 6;

interface Props {
  value: string;
  onChange: (digits: string) => void;
  /** Called once all six digits are in. */
  onComplete?: (digits: string) => void;
  busy?: boolean;
  accessibilityLabel: string;
}

/**
 * Six filled cells over ONE real input (paste and one-time-code autofill land
 * there). The same look as the WhatsApp code step (PhoneCodeFlow): fill, no
 * hairline, the active cell one step lighter.
 */
export const CodeCells = forwardRef<TextInput, Props>(function CodeCells(
  { value, onChange, onComplete, busy, accessibilityLabel },
  ref,
) {
  const focus = () => (ref && typeof ref !== 'function' ? ref.current?.focus() : undefined);
  return (
    <Pressable onPress={focus} style={styles.row} accessible={false}>
      {Array.from({ length: CODE_LENGTH }).map((_, i) => {
        const active = i === value.length && !busy;
        return (
          <View key={i} style={[styles.cell, active && styles.cellActive]}>
            <Text style={styles.digit}>{value[i] ?? ''}</Text>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(raw) => {
          const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
          onChange(digits);
          if (digits.length === CODE_LENGTH) onComplete?.(digits);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={CODE_LENGTH}
        editable={!busy}
        caretHidden
        accessibilityLabel={accessibilityLabel}
        style={styles.input}
      />
    </Pressable>
  );
});

const CELL = 48;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: {
    width: CELL,
    height: CELL + 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { backgroundColor: colors.surfaceRaised },
  digit: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  input: { ...StyleSheet.absoluteFillObject, opacity: 0.011, color: 'transparent', fontSize: 1 },
});

export default CodeCells;
