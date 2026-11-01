import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Check, X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { API_BASE_URL, backendJson } from '../../lib/api/backend';
import { radius, spacing } from '../../theme/tokens';

/**
 * "Make a poster" (mobile twin of the web composer's PosterTemplatePicker).
 *
 * The templates live only on the website (lib/posters/templates): this sheet
 * reads the list from /api/posters/catalog, shows each one as a live preview
 * drawn with this event's facts (/api/posters/preview), and on "Use" has the
 * server draw it full size and store it (/api/posters/create).
 */

export interface PosterFacts {
  title: string;
  /** "YYYY-MM-DD" and 24h "HH:mm". */
  date: string;
  time: string;
  venue?: string;
  city?: string;
  lineup?: string[];
}

export interface PosterSpec {
  template: string;
  palette: number;
  photo: string | null;
}

interface CatalogTemplate {
  id: string;
  usesPhoto: boolean;
  palettes: { bg: string; accent: string }[];
}

interface LibraryFlyer {
  thumbUrl: string;
  fullUrl: string;
}

/** Same stable colourway pick as the web picker, so both devices agree. */
function defaultPalette(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 3;
}

function query(facts: PosterFacts, spec: PosterSpec, locale: string) {
  const q = new URLSearchParams({
    template: spec.template,
    palette: String(spec.palette),
    title: facts.title,
    start: `${facts.date}T${facts.time || '20:00'}`,
    venue: facts.venue || '',
    city: facts.city || '',
    lineup: (facts.lineup || []).join('|'),
    locale: ['ht', 'fr', 'en'].includes(locale) ? locale : 'ht',
  });
  if (spec.photo) q.set('photo', spec.photo);
  return q;
}

/** Draws `spec` with `facts` full size and stores it; resolves to the image URL. */
export async function makePoster(facts: PosterFacts, spec: PosterSpec, locale: string): Promise<string> {
  const body: Record<string, unknown> = Object.fromEntries(query(facts, spec, locale).entries());
  body.lineup = facts.lineup || [];
  const json = await backendJson<{ url?: string }>('/api/posters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as any);
  if (!json?.url) throw new Error('failed');
  return json.url;
}

/** Remote (http) photos only: a device file isn't reachable by the server until it's uploaded. */
const isRemote = (u?: string | null) => !!u && /^https:\/\//.test(u);

export default function PosterTemplateSheet({
  visible,
  facts,
  photo: ownPhoto,
  onClose,
  onPick,
}: {
  visible: boolean;
  facts: PosterFacts;
  photo?: string | null;
  onClose: () => void;
  onPick: (url: string, spec: PosterSpec) => void;
}) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [library, setLibrary] = useState<LibraryFlyer[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [palettes, setPalettes] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    backendJson<{ templates: CatalogTemplate[] }>('/api/posters/catalog')
      .then((j) => {
        setTemplates(j.templates || []);
        setSelected((cur) => cur || j.templates?.[0]?.id || '');
      })
      .catch(() => setError(t('posterTemplates.failed')));
    backendJson<{ items: LibraryFlyer[] }>('/api/flyers/library')
      .then((j) => setLibrary((j.items || []).slice(0, 10)))
      .catch(() => {});
  }, [visible, t]);

  const photos = useMemo(() => {
    const lib = library.map((f) => ({ full: f.fullUrl, thumb: f.thumbUrl }));
    return isRemote(ownPhoto) ? [{ full: ownPhoto as string, thumb: ownPhoto as string }, ...lib] : lib;
  }, [library, ownPhoto]);

  useEffect(() => {
    if (!photo && photos[0]) setPhoto(photos[0].full);
  }, [photos, photo]);

  const seed = `${facts.title}|${facts.date}`;
  const paletteOf = (id: string) => palettes[id] ?? defaultPalette(`${seed}|${id}`);
  const specFor = (tpl: CatalogTemplate): PosterSpec => ({
    template: tpl.id,
    palette: paletteOf(tpl.id),
    photo: tpl.usesPhoto ? photo : null,
  });

  const use = async () => {
    const tpl = templates.find((x) => x.id === selected);
    if (!tpl) return;
    setSaving(true);
    setError('');
    try {
      const spec = specFor(tpl);
      onPick(await makePoster(facts, spec, language), spec);
    } catch {
      setError(t('posterTemplates.failed'));
    } finally {
      setSaving(false);
    }
  };

  const rows: CatalogTemplate[][] = [];
  for (let i = 0; i < templates.length; i += 2) rows.push(templates.slice(i, i + 2));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('posterTemplates.title')}</Text>
              <Text style={styles.hint}>{t('posterTemplates.hint')}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>{t('posterTemplates.photo')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow} contentContainerStyle={{ gap: 8 }}>
            {photos.map((p) => (
              <TouchableOpacity
                key={p.full}
                onPress={() => setPhoto(p.full)}
                accessibilityRole="button"
                accessibilityState={{ selected: photo === p.full }}
                style={[styles.photoThumb, photo === p.full ? styles.photoThumbOn : styles.photoThumbOff]}
              >
                <Image source={{ uri: p.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.md }} showsVerticalScrollIndicator={false}>
            {templates.length === 0 && !error ? (
              <View style={styles.state}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : null}
            {rows.map((row, i) => (
              <View key={i} style={styles.gridRow}>
                {row.map((tpl) => {
                  const on = selected === tpl.id;
                  const spec = specFor(tpl);
                  const uri = `${API_BASE_URL}/api/posters/preview?${query(facts, spec, language)}`;
                  return (
                    <View key={tpl.id} style={{ flex: 1 }}>
                      <TouchableOpacity
                        onPress={() => setSelected(tpl.id)}
                        activeOpacity={0.9}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[styles.tile, on && styles.tileOn]}
                      >
                        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" />
                        {on ? (
                          <View style={styles.check}>
                            <Check size={14} color="#0A0A0A" />
                          </View>
                        ) : null}
                      </TouchableOpacity>
                      <View style={styles.swatches}>
                        {tpl.palettes.map((p, pi) => {
                          const active = paletteOf(tpl.id) === pi;
                          return (
                            <TouchableOpacity
                              key={pi}
                              onPress={() => {
                                setSelected(tpl.id);
                                setPalettes((prev) => ({ ...prev, [tpl.id]: pi }));
                              }}
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel={t('posterTemplates.colour', { n: pi + 1 })}
                              accessibilityState={{ selected: active }}
                              style={[styles.swatch, active ? styles.swatchOn : styles.swatchOff, { backgroundColor: p.bg }]}
                            >
                              <View style={[styles.swatchHalf, { backgroundColor: p.accent }]} />
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
                {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
              </View>
            ))}
          </ScrollView>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={[styles.use, saving && { opacity: 0.6 }]} onPress={use} disabled={saving || !selected} accessibilityRole="button">
            {saving ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.useText}>{t('posterTemplates.use')}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
      height: '92%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginTop: spacing.md,
      marginBottom: spacing.lg,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, marginBottom: spacing.lg },
    title: { fontSize: 20, fontWeight: '700', color: colors.text },
    hint: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
    label: {
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textTertiary,
      marginBottom: 8,
    },
    photoRow: { flexGrow: 0, marginBottom: spacing.lg },
    photoThumb: { width: 44, height: 56, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
    // Selection is fill/size, not an outline (house rule): the chosen photo
    // is full strength, the rest recede.
    photoThumbOn: { opacity: 1, transform: [{ scale: 1.06 }] },
    photoThumbOff: { opacity: 0.5 },
    gridRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
    tile: { aspectRatio: 4 / 5, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
    tileOn: { opacity: 1 },
    check: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatches: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    swatch: { borderRadius: 999, overflow: 'hidden', flexDirection: 'row' },
    swatchOn: { width: 20, height: 20 },
    swatchOff: { width: 14, height: 14, opacity: 0.6 },
    swatchHalf: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%' },
    state: { paddingVertical: spacing.xl, alignItems: 'center' },
    error: { fontSize: 13, color: '#FCA5A5', marginBottom: 8 },
    use: {
      height: 50,
      borderRadius: radius.md,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    useText: { fontSize: 15, fontWeight: '700', color: '#0A0A0A' },
  });
