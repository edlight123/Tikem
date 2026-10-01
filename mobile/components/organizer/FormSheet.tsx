import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing } from '../../theme/tokens';

interface FormSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Accessibility label for the close button. */
  closeLabel: string;
  /** Blocks backdrop / close while a write is in flight. */
  busy?: boolean;
  children: React.ReactNode;
  /** Pinned under the scrolling fields: the sheet's one white pill, plus any text link. */
  footer?: React.ReactNode;
}

/**
 * The organizer's add / edit bottom sheet. Same shell as DeleteAccountSheet: a
 * `surface` sheet over a dimmed canvas, a grabber, a bold title with a round
 * close button. Fields inside sit one brightness step up (`surfaceRaised`), so
 * the form reads as filled surfaces, never hairline boxes.
 */
export default function FormSheet({
  visible,
  title,
  onClose,
  closeLabel,
  busy = false,
  children,
  footer,
}: FormSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} accessibilityLabel={closeLabel} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoid}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Uppercase muted field label, matching DeleteAccountSheet. */
export function SheetLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return <Text style={styles.label}>{children}</Text>;
}

/** A filled text field (surfaceRaised on the sheet's surface). */
export function SheetInput(props: TextInputProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <TextInput
      placeholderTextColor={colors.textTertiary}
      selectionColor={colors.primary}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    avoid: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '90%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: 10,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceRaised,
      marginBottom: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginBottom: 4,
    },
    title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { flexGrow: 0 },
    footer: { marginTop: spacing.xl, gap: spacing.md },
    label: {
      marginTop: 18,
      marginBottom: 8,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textTertiary,
    },
    input: {
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.surfaceRaised,
    },
  });
