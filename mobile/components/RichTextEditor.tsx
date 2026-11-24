import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Bold, Italic, List, ListOrdered } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { colors as T, radius } from '../theme/tokens';
import { Touchable } from './ui/Touchable';
import { continueList, toggleList, toggleWrap, type EditResult, type Selection } from '../lib/richText';

/**
 * A multiline description field with a small formatting bar above it:
 * Bold, Italic, Bulleted list, Numbered list. What is saved is still one plain
 * string in the light markdown lib/richText reads (**bold**, *italic*, "- ",
 * "1. "), so old descriptions keep working and nothing native is needed.
 *
 * `onReveal` is called with the wrapper (bar + field) whenever the field is
 * focused, grows, or the caret moves, so the screen can keep it above the
 * keyboard.
 */
type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  maxLength?: number;
  onReveal?: (node: View | null) => void;
  onBlur?: () => void;
};

export default function RichTextEditor({ value, onChangeText, placeholder, maxLength, onReveal, onBlur }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const wrapRef = useRef<View>(null);
  const selRef = useRef<Selection>({ start: value.length, end: value.length });
  // Set only for the render right after a toolbar edit, so the caret lands
  // where the edit says; left undefined otherwise so typing is never fought.
  const [forcedSel, setForcedSel] = useState<Selection | undefined>(undefined);
  const [focused, setFocused] = useState(false);

  const reveal = useCallback(() => onReveal?.(wrapRef.current), [onReveal]);

  const apply = (r: EditResult) => {
    if (maxLength != null && r.text.length > maxLength) return;
    selRef.current = r.selection;
    setForcedSel(r.selection);
    onChangeText(r.text);
  };

  const run = (edit: (text: string, sel: Selection) => EditResult) => apply(edit(value, selRef.current));

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selRef.current = e.nativeEvent.selection;
    if (forcedSel) setForcedSel(undefined);
  };

  const onChange = (next: string) => {
    const r = continueList(value, next);
    if (r) apply(r);
    else onChangeText(next);
  };

  const buttons = [
    { key: 'bold', Icon: Bold, label: t('richText.bold'), edit: (s: string, sel: Selection) => toggleWrap(s, sel, '**') },
    { key: 'italic', Icon: Italic, label: t('richText.italic'), edit: (s: string, sel: Selection) => toggleWrap(s, sel, '*') },
    { key: 'bullets', Icon: List, label: t('richText.bulletList'), edit: (s: string, sel: Selection) => toggleList(s, sel, 'bullet') },
    { key: 'numbers', Icon: ListOrdered, label: t('richText.numberedList'), edit: (s: string, sel: Selection) => toggleList(s, sel, 'number') },
  ];

  return (
    <View ref={wrapRef} collapsable={false} style={[styles.wrap, { borderBottomColor: colors.border }]}>
      <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel={t('richText.toolbar')}>
        {buttons.map(({ key, Icon, label, edit }) => (
          <Touchable
            key={key}
            style={[styles.btn, { backgroundColor: focused ? T.surfaceRaised : colors.surface }]}
            onPress={() => run(edit)}
            scale={0.92}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Icon size={17} strokeWidth={2} color={focused ? colors.text : colors.textSecondary} />
          </Touchable>
        ))}
      </View>
      <TextInput
        style={[styles.input, { color: colors.text }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        selectionColor={colors.primary}
        value={value}
        onChangeText={onChange}
        selection={forcedSel}
        onSelectionChange={(e) => {
          onSelectionChange(e);
          if (focused) reveal();
        }}
        onFocus={() => {
          setFocused(true);
          reveal();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onContentSizeChange={() => {
          if (focused) reveal();
        }}
        multiline
        // Grows with the text up to a cap, then scrolls inside itself, so the
        // whole field (and the caret) fits above the keyboard.
        scrollEnabled
        maxLength={maxLength}
        autoCapitalize="sentences"
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Same quiet hairline under the row as the form's other fields.
  wrap: { paddingTop: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  btn: {
    width: 36,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    fontSize: 16,
    lineHeight: 22,
    minHeight: 110,
    maxHeight: 220,
    padding: 0,
    textAlign: 'auto',
  },
});
