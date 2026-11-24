/**
 * Small form pieces shared by the community screens (Share an event, Claim
 * it): a filled single-line input, a chip row, and a quiet label. Fills, not
 * outlines (POSH ladder): inputs sit on `surface`, a chosen chip is the one
 * pure white.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { colors as T, radius } from '../../theme/tokens';
import { Touchable } from '../ui/Touchable';

export function FieldLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.textSecondary }]}>{children}</Text>;
}

export function FieldInput(props: TextInputProps & { label?: string }) {
  const { colors } = useTheme();
  const { label, style, multiline, ...rest } = props;
  return (
    <View style={styles.field}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <TextInput
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        accessibilityLabel={label || props.placeholder}
        {...rest}
        style={[styles.input, multiline && styles.inputMulti, { backgroundColor: colors.surface, color: colors.text }, style]}
      />
    </View>
  );
}

export function ChipRow<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: V; label: string }>;
  value: V | null | '';
  onChange: (v: V) => void;
  label?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Touchable
              key={o.value}
              style={[styles.chip, { backgroundColor: active ? T.white : T.surfaceRaised }]}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, { color: active ? T.onWhite : colors.textSecondary }]}>{o.label}</Text>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMulti: { minHeight: 88 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.button },
  chipText: { fontSize: 13, fontWeight: '700' },
});
