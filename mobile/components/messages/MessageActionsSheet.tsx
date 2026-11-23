import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Copy, CornerUpLeft, Flag } from 'lucide-react-native';
import { colors as T, radius, withAlpha } from '../../theme/tokens';
import { Touchable } from '../ui/Touchable';
import { REACTIONS, fill, useReducedMotion, type MessageStrings, type Reaction } from './types';

/** Window rectangle of the pressed bubble (measureInWindow). */
export type BubbleRect = { x: number; y: number; width: number; height: number };

const EMOJI_BTN = 44;
const BAR_PAD = 6;
const BAR_GAP = 2;
const ROW_H = 44;
const MENU_W = 200;
/** Space between the bar, the bubble and the menu. */
const GAP = 8;
/** Space between the menu's two groups (Report stands apart). */
const CARD_GAP = 6;
const SIDE = 12;

/**
 * The long-press menu on a message bubble: the thread blurs and dims, the
 * pressed bubble is lifted out where it sits, a bar of the six reactions sits
 * above it (the viewer's own reaction filled) and the actions sit below it:
 * Reply, Copy (only when this build has a clipboard), and, on the other side's
 * messages, Report in its own group. Placed against the bubble's window
 * rectangle and clamped inside the safe area, so a bubble near the top or the
 * bottom (or one taller than the screen) never pushes the menu off screen.
 *
 * Dark POSH: raised fills on the dimmed canvas, one 4pt radius, line icons,
 * no borders. Reduce Motion: the layers simply appear.
 */
export default function MessageActionsSheet({
  visible,
  anchor,
  preview,
  mine,
  canReact,
  canReply,
  canCopy,
  canReport,
  strings,
  onReact,
  onReply,
  onCopy,
  onReport,
  onClose,
}: {
  visible: boolean;
  /** The pressed bubble's window rectangle; without it the menu floats mid-screen. */
  anchor?: BubbleRect | null;
  /** A non-interactive copy of the bubble, drawn lifted over the blur. */
  preview?: React.ReactNode;
  /** The viewer's current reaction on this message, if any. */
  mine: Reaction | null;
  canReact: boolean;
  canReply: boolean;
  canCopy: boolean;
  canReport: boolean;
  strings: MessageStrings;
  onReact: (emoji: Reaction) => void;
  onReply: () => void;
  onCopy: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  // Keep drawing the last message while the modal fades out (the screen clears
  // its selection the moment an action is chosen).
  const last = useRef({ anchor, preview, mine, canReact, canReply, canCopy, canReport });
  if (visible) last.current = { anchor, preview, mine, canReact, canReply, canCopy, canReport };
  const s = last.current;

  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, reduceMotion, progress]);

  const mainRows = (s.canReply ? 1 : 0) + (s.canCopy ? 1 : 0);
  const menuH = mainRows * ROW_H + (s.canReport ? ROW_H + (mainRows ? CARD_GAP : 0) : 0);

  // Emoji buttons shrink on narrow phones so the bar always fits.
  const btn = Math.min(
    EMOJI_BTN,
    Math.floor((W - SIDE * 2 - BAR_PAD * 2 - BAR_GAP * (REACTIONS.length - 1)) / REACTIONS.length),
  );
  const barW = btn * REACTIONS.length + BAR_GAP * (REACTIONS.length - 1) + BAR_PAD * 2;
  const barH = s.canReact ? btn + BAR_PAD * 2 : 0;
  const barGap = barH ? GAP : 0;

  const safeTop = insets.top + 8;
  const safeBottom = H - insets.bottom - 8;
  const rect: BubbleRect = s.anchor ?? { x: SIDE, y: H / 2, width: W - SIDE * 2, height: 0 };
  const menuGap = menuH ? GAP : 0;
  const maxBubbleH = Math.max(44, safeBottom - safeTop - barH - barGap - menuGap - menuH);
  const bubbleH = Math.min(rect.height, maxBubbleH);
  const total = barH + barGap + bubbleH + menuGap + menuH;
  const top = Math.max(safeTop, Math.min(rect.y - barH - barGap, safeBottom - total));
  const bubbleTop = top + barH + barGap;
  const menuTop = bubbleTop + bubbleH + menuGap;

  // Hug the bubble's side: the viewer's own (right) or the other's (left).
  const alignEnd = rect.x + rect.width / 2 > W / 2;
  const clampX = (x: number, w: number) => Math.max(SIDE, Math.min(x, W - SIDE - w));
  const barX = clampX(alignEnd ? rect.x + rect.width - barW : rect.x, barW);
  const menuX = clampX(alignEnd ? rect.x + rect.width - MENU_W : rect.x, MENU_W);

  const fade = progress.interpolate({ inputRange: [0, 0.6], outputRange: [0, 1], extrapolate: 'clamp' });
  const barLift = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const menuLift = progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });
  const bubbleScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  const row = (key: string, label: string, icon: React.ReactNode, onPress: () => void, danger = false) => (
    <Touchable
      key={key}
      style={styles.row}
      onPress={onPress}
      scale={false}
      pressedColor={T.neutralMuted}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.rowText, danger && styles.rowTextDanger]} numberOfLines={1}>
        {label}
      </Text>
      {icon}
    </Touchable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
        {/* The blur and dim only paint; the empty Pressable over them takes the
            tap that closes the menu (a BlurView child swallowed it on iOS). */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, styles.dim]} pointerEvents="none" />
        </View>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={strings.close}
        />

        {s.anchor && s.preview ? (
          <Animated.View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[
              styles.lifted,
              { left: rect.x, top: bubbleTop, width: rect.width, transform: [{ scale: bubbleScale }] },
            ]}
          >
            <View style={[styles.liftedClip, { maxHeight: bubbleH }]}>{s.preview}</View>
          </Animated.View>
        ) : null}

        {barH ? (
          <Animated.View
            style={[
              styles.bar,
              { left: barX, top, width: barW, height: barH, opacity: fade, transform: [{ translateY: barLift }] },
            ]}
          >
            {REACTIONS.map((emoji) => {
              const selected = s.mine === emoji;
              return (
                <Touchable
                  key={emoji}
                  style={[styles.emojiButton, { width: btn, height: btn }, selected && styles.emojiSelected]}
                  onPress={() => onReact(emoji)}
                  scale={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={fill(strings.react, { emoji })}
                >
                  <Text style={styles.emoji} allowFontScaling={false}>
                    {emoji}
                  </Text>
                </Touchable>
              );
            })}
          </Animated.View>
        ) : null}

        {menuH ? (
          <Animated.View
            style={[
              styles.menu,
              { left: menuX, top: menuTop, width: MENU_W, opacity: fade, transform: [{ translateY: menuLift }] },
            ]}
          >
            {mainRows ? (
              <View style={styles.group}>
                <View style={styles.groupClip}>
                {s.canReply
                  ? row('reply', strings.reply, <CornerUpLeft size={18} color={T.textPrimary} strokeWidth={1.75} />, onReply)
                  : null}
                {s.canCopy ? row('copy', strings.copy, <Copy size={17} color={T.textPrimary} strokeWidth={1.75} />, onCopy) : null}
                </View>
              </View>
            ) : null}
            {s.canReport ? (
              <View style={styles.group}>
                <View style={styles.groupClip}>
                {row('report', strings.report, <Flag size={17} color={T.red} strokeWidth={1.75} />, onReport, true)}
                </View>
              </View>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const SHADOW = {
  shadowColor: T.black,
  shadowOpacity: 0.5,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
  elevation: 12,
} as const;

const styles = StyleSheet.create({
  dim: { backgroundColor: withAlpha(T.bg, 0.55) },
  lifted: { position: 'absolute', ...SHADOW },
  // The shadow sits on the outer view; the clip keeps a very tall bubble inside its slot.
  liftedClip: { overflow: 'hidden', borderRadius: radius.md },
  bar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: BAR_PAD,
    gap: BAR_GAP,
    borderRadius: radius.md,
    backgroundColor: T.surfaceRaised,
    ...SHADOW,
  },
  emojiButton: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  emojiSelected: { backgroundColor: T.neutralMuted },
  emoji: { fontSize: 26, lineHeight: 32, textAlign: 'center' },
  menu: { position: 'absolute', gap: CARD_GAP },
  // Shadow on the group, clip inside it, so a pressed row keeps the corners.
  group: { borderRadius: radius.md, backgroundColor: T.surfaceRaised, ...SHADOW },
  groupClip: { borderRadius: radius.md, overflow: 'hidden' },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
  },
  rowText: { flexShrink: 1, fontSize: 15, fontWeight: '500', color: T.textPrimary },
  rowTextDanger: { color: T.red },
});
