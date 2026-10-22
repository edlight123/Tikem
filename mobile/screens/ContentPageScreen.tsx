import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react-native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { Skeleton } from '../components/Skeleton';
import { font, radius } from '../theme/tokens';
import { resolveLocalizedContent } from '../types/contentPage';
import type { ContentBlock, LocalizedContent } from '../types/contentPage';

// Collapsible sections animate their height. LayoutAnimation is on by default on
// iOS; Android needs this one-time opt-in (old arch).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

type Role = 'attendee' | 'organizer' | 'common';
type Section = { title: string; role: Role; blocks: ContentBlock[] };
type QA = { question: string; answer: ContentBlock[] };

// Split the flat block list into an intro (blocks before the first h2) and
// collapsible sections (one per h2). Role prefixes on support categories drive
// the Attendee/Organizer filter and are stripped from the displayed title.
function rolePrefix(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\s*[—–-]\\s*`);
}

function parseSections(
  blocks: ContentBlock[],
  roleLabels?: { attendee: string; organizer: string },
): { intro: ContentBlock[]; sections: Section[] } {
  const attendeeRe = rolePrefix(roleLabels?.attendee || 'Attendee');
  const organizerRe = rolePrefix(roleLabels?.organizer || 'Organizer');
  const intro: ContentBlock[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const b of blocks || []) {
    if (b.type === 'heading' && b.level === 2) {
      let title = b.text;
      let role: Role = 'common';
      if (attendeeRe.test(title)) {
        role = 'attendee';
        title = title.replace(attendeeRe, '');
      } else if (organizerRe.test(title)) {
        role = 'organizer';
        title = title.replace(organizerRe, '');
      }
      current = { title, role, blocks: [] };
      sections.push(current);
    } else if (current) {
      current.blocks.push(b);
    } else {
      intro.push(b);
    }
  }
  return { intro, sections };
}

// Within a support section, split into a lead (blocks before the first question)
// and Q&A items (each h3 question + the blocks that answer it).
function splitQA(blocks: ContentBlock[]): { lead: ContentBlock[]; questions: QA[] } {
  const lead: ContentBlock[] = [];
  const questions: QA[] = [];
  let current: QA | null = null;
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 3) {
      current = { question: b.text, answer: [] };
      questions.push(current);
    } else if (current) {
      current.answer.push(b);
    } else {
      lead.push(b);
    }
  }
  return { lead, questions };
}

/**
 * Renders a legal/help page from Firestore `content_pages/{slug}` NATIVELY in
 * POSH style — the same single source the web app renders. Content is shown as a
 * collapsible accordion: each h2 is a tap-to-open section, and on the Help Center
 * each question is its own tap-to-expand FAQ row (with an Attendee/Organizer
 * filter). Cached in AsyncStorage so it still renders offline.
 */
export default function ContentPageScreen({ route, navigation }: any) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  // The title bar is a blurred overlay now, so the content beneath reserves its
  // measured height (see OverlayHeader).
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const slug: string = route?.params?.slug;
  const routeTitle: string | undefined = route?.params?.title;

  const [docData, setDocData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [role, setRole] = useState<'attendee' | 'organizer'>('attendee');
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(new Set());
  // Scroll offset for the header chrome: solid canvas at rest, translucent
  // only once the page has actually scrolled underneath (see OverlayHeader).
  const scrollY = useRef(new Animated.Value(0)).current;

  const isFaq = slug === 'support';
  const cacheKey = `content_page_cache_${slug}`;

  const load = React.useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const snap = await getDoc(doc(db, 'content_pages', slug));
      if (snap.exists()) {
        const data = { slug, ...(snap.data() as any) };
        setDocData(data);
        try {
          await AsyncStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {}
      } else {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) setDocData(JSON.parse(raw));
        else setFailed(true);
      }
    } catch {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) setDocData(JSON.parse(raw));
        else setFailed(true);
      } catch {
        setFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, [slug, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  const content: LocalizedContent | null = useMemo(
    () => resolveLocalizedContent(docData, language),
    [docData, language],
  );
  const { intro, sections } = useMemo(
    () => parseSections(content?.blocks || [], content?.roleLabels),
    [content],
  );

  // Support: only the selected role's categories (+ common sections). Others: all.
  const visibleSections = useMemo(
    () =>
      sections
        .map((s, i) => ({ section: s, index: i }))
        .filter(({ section }) => (isFaq ? section.role === role || section.role === 'common' : true)),
    [sections, isFaq, role],
  );

  const toggleSection = (index: number) => {
    animate();
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const toggleQuestion = (key: string) => {
    animate();
    setOpenQuestions((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const switchRole = (next: 'attendee' | 'organizer') => {
    if (next === role) return;
    animate();
    setRole(next);
    setOpenSections(new Set());
    setOpenQuestions(new Set());
  };

  const headerTitle = content?.title || routeTitle || '';

  const header = (
    <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <ArrowLeft size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {headerTitle}
      </Text>
      <View style={styles.backButton} />
    </OverlayHeader>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      {header}

      {loading ? (
        // No scroll container here — pad the placeholder by hand.
        <View style={{ paddingTop: headerH }}>
          <ContentSkeleton colors={colors} />
        </View>
      ) : failed || !content ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>{t('contentPage.unavailableTitle')}</Text>
          <Text style={styles.emptyBody}>{t('contentPage.unavailableBody')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.8}>
            <RotateCcw size={16} color={colors.text} />
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Animated.ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            padding: 20,
            paddingTop: headerH + 20,
            paddingBottom: insets.bottom + 40,
          }}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
        >
          <Text style={styles.pageTitle}>{content.title}</Text>
          {content.updated ? (
            <Text style={styles.updated}>
              {t('contentPage.updatedPrefix')} {content.updated}
            </Text>
          ) : null}

          {content.draft ? (
            <View style={styles.draftNote}>
              <Text style={styles.draftNoteText}>{t('contentPage.draftNote')}</Text>
            </View>
          ) : null}

          {/* Intro (e.g. the Help Center hero line) shown above the accordion. */}
          {intro.map((block, i) => (
            <Block key={`intro-${i}`} block={block} styles={styles} colors={colors} />
          ))}

          {/* Attendee / Organizer filter (Help Center only). */}
          {isFaq ? (
            <View style={styles.roleToggle}>
              {(['attendee', 'organizer'] as const).map((r) => {
                const active = role === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.rolePill, active && styles.rolePillActive]}
                    onPress={() => switchRole(r)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.rolePillText, active && styles.rolePillTextActive]}>
                      {r === 'attendee' ? t('profile.modeAttendee') : t('profile.modeOrganizer')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <View style={styles.sections}>
            {visibleSections.map(({ section, index }) => (
              <AccordionSection
                key={index}
                section={section}
                open={openSections.has(index)}
                onToggle={() => toggleSection(index)}
                isFaq={isFaq}
                sectionIndex={index}
                openQuestions={openQuestions}
                onToggleQuestion={toggleQuestion}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        </Animated.ScrollView>
      )}
    </View>
  );
}

function AccordionSection({
  section,
  open,
  onToggle,
  isFaq,
  sectionIndex,
  openQuestions,
  onToggleQuestion,
  styles,
  colors,
}: {
  section: Section;
  open: boolean;
  onToggle: () => void;
  isFaq: boolean;
  sectionIndex: number;
  openQuestions: Set<string>;
  onToggleQuestion: (key: string) => void;
  styles: ReturnType<typeof getStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { lead, questions } = useMemo(() => splitQA(section.blocks), [section.blocks]);
  const asFaq = isFaq && questions.length > 0;

  return (
    <View style={styles.sectionCard}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.sectionTitle}>{section.title}</Text>
        {open ? (
          <ChevronUp size={18} color={colors.textSecondary} />
        ) : (
          <ChevronDown size={18} color={colors.textSecondary} />
        )}
      </TouchableOpacity>

      {open ? (
        <View style={styles.sectionBody}>
          {asFaq ? (
            <>
              {lead.map((block, i) => (
                <Block key={`lead-${i}`} block={block} styles={styles} colors={colors} />
              ))}
              {questions.map((qa, qi) => {
                const key = `${sectionIndex}:${qi}`;
                const qOpen = openQuestions.has(key);
                return (
                  <View key={key} style={styles.qaItem}>
                    <TouchableOpacity
                      style={styles.qaHeader}
                      onPress={() => onToggleQuestion(key)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: qOpen }}
                    >
                      <Text style={styles.qaQuestion}>{qa.question}</Text>
                      {qOpen ? (
                        <ChevronUp size={16} color={colors.textTertiary} />
                      ) : (
                        <ChevronDown size={16} color={colors.textTertiary} />
                      )}
                    </TouchableOpacity>
                    {qOpen ? (
                      <View style={styles.qaAnswer}>
                        {qa.answer.map((block, i) => (
                          <Block key={i} block={block} styles={styles} colors={colors} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : (
            section.blocks.map((block, i) => (
              <Block key={i} block={block} styles={styles} colors={colors} />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function Block({
  block,
  styles,
  colors,
}: {
  block: ContentBlock;
  styles: ReturnType<typeof getStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  switch (block.type) {
    case 'heading':
      return <Text style={block.level === 3 ? styles.heading3 : styles.heading2}>{block.text}</Text>;
    case 'paragraph':
      return <Text style={styles.paragraph}>{block.text}</Text>;
    case 'list':
      return (
        <View style={styles.list}>
          {block.items?.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.listMarker}>{block.ordered ? `${i + 1}.` : '•'}</Text>
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
        </View>
      );
    case 'callout':
      return (
        <View style={styles.callout}>
          {block.title ? <Text style={styles.calloutTitle}>{block.title}</Text> : null}
          {block.text ? <Text style={styles.calloutText}>{block.text}</Text> : null}
          {block.items?.length ? (
            <View style={styles.calloutList}>
              {block.items.map((item, i) => (
                <View key={i} style={styles.listItem}>
                  <Text style={styles.calloutMarker}>•</Text>
                  <Text style={styles.calloutText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      );
    default:
      return null;
  }
}

/** Content skeleton: a title line, a caption, and a few collapsed-section bars. */
function ContentSkeleton({ colors }: { colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={{ padding: 20 }}>
      <Skeleton width={'70%'} height={30} radius={4} />
      <Skeleton width={'34%'} height={12} radius={4} style={{ marginTop: 12 }} />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} width={'100%'} height={54} radius={4} style={{ marginTop: 12 }} />
      ))}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // Overlay chrome (OverlayHeader owns the safe-area padding, the row layout,
    // the blur backdrop and the absolute placement) — only the horizontal inset
    // is ours. No fill and no hairline: they would paint over the blur.
    header: {
      paddingHorizontal: 8,
    },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 22, color: colors.text },
    scroll: { flex: 1 },

    pageTitle: {
      fontFamily: font.serif,
      fontSize: 32,
      lineHeight: 36,
      color: colors.text,
    },
    updated: {
      fontSize: 12,
      letterSpacing: 0.3,
      color: colors.textTertiary,
      marginTop: 8,
    },
    draftNote: {
      marginTop: 16,
      backgroundColor: colors.warningLight,
      borderRadius: radius.chip,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    draftNoteText: {
      fontSize: 12.5,
      lineHeight: 18,
      color: colors.warning,
    },

    // Attendee / Organizer segmented filter (Help Center).
    roleToggle: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 20,
    },
    rolePill: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.button,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rolePillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    rolePillText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    rolePillTextActive: {
      color: colors.onPrimary,
      fontWeight: '700',
    },

    sections: {
      marginTop: 16,
      gap: 10,
    },
    // Collapsible section: an elevated surface card (POSH — separation by
    // brightness, not a 1px outline).
    sectionCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.button,
      overflow: 'hidden',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 16,
      paddingHorizontal: 16,
    },
    sectionTitle: {
      flex: 1,
      fontFamily: font.serif,
      fontSize: 18,
      color: colors.text,
    },
    sectionBody: {
      paddingHorizontal: 16,
      paddingBottom: 8,
    },

    // FAQ question row (nested tap-to-expand inside a support section).
    qaItem: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    qaHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 14,
    },
    qaQuestion: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 21,
    },
    qaAnswer: {
      paddingBottom: 14,
    },

    heading2: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginTop: 20,
      marginBottom: 2,
    },
    heading3: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginTop: 16,
      marginBottom: 2,
    },
    paragraph: {
      fontSize: 15,
      lineHeight: 24,
      color: colors.textSecondary,
      marginTop: 10,
    },

    list: {
      marginTop: 10,
      gap: 8,
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    listMarker: {
      fontSize: 15,
      lineHeight: 24,
      color: colors.textSecondary,
      width: 22,
    },
    listText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 24,
      color: colors.textSecondary,
    },

    // POSH callout: left teal accent bar on a teal-tinted raised box.
    callout: {
      marginTop: 16,
      backgroundColor: colors.primarySoft,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: 16,
      paddingHorizontal: 16,
    },
    calloutTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
    },
    calloutText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    calloutList: {
      marginTop: 4,
      gap: 6,
    },
    calloutMarker: {
      fontSize: 14,
      lineHeight: 22,
      color: colors.primary,
      width: 18,
    },

    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    emptyBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    retryButton: {
      marginTop: 24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: radius.button,
      backgroundColor: colors.surfaceRaised,
    },
    retryText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
  });
