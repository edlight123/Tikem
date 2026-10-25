/**
 * The event's trailer, playing on the page (owner ask 2026-10-25).
 *
 * A recognised YouTube/Vimeo link plays MUTED and looping inline as soon as
 * the event page is open, the way Instagram previews video: phones only
 * autoplay without sound. "Tap for sound" opens the full player (in-app
 * WebView screen) with sound. Profile > Sound > "Play trailers automatically"
 * (on by default, lib/songAutoplay) turns the preview off for anyone watching
 * their data; the card then shows the still and plays on a tap. Leaving the
 * screen unmounts the player, which stops it.
 *
 * The embed loads inside an HTML page with baseUrl www.tikem.co so YouTube
 * gets a referrer (bare embed URLs in a WebView can be refused). Renders
 * nothing for a link we cannot embed; the caller keeps its plain link row.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Image } from 'expo-image';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { parseVideoEmbed } from '../lib/videoEmbed';
import { useTrailerAutoplayAllowed } from '../lib/songAutoplay';
import { radius } from '../theme/tokens';

function frameHtml(src: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden;height:100%}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none}</style></head>
<body><iframe src=${JSON.stringify(src)} allow="autoplay; encrypted-media; picture-in-picture" playsinline></iframe></body></html>`;
}

export default function TrailerCard({ url, title }: { url?: string | null; title: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const navigation: any = useNavigation();
  const isFocused = useIsFocused();
  const autoplay = useTrailerAutoplayAllowed();
  const embed = parseVideoEmbed(url);
  if (!embed) return null;

  const styles = getStyles(colors);
  const openWithSound = () =>
    navigation.navigate('InAppWebView', { url: embed.embedUrl, title });

  return (
    <View style={styles.section}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={openWithSound}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={styles.frame}
      >
        {autoplay && isFocused ? (
          <WebView
            source={{ html: frameHtml(embed.mutedEmbedUrl), baseUrl: 'https://www.tikem.co' }}
            originWhitelist={['*']}
            style={styles.web}
            scrollEnabled={false}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            pointerEvents="none"
            // The embed's own links must never navigate this little frame.
            onShouldStartLoadWithRequest={(req) =>
              req.isTopFrame === false || req.url === 'about:blank' || req.url.startsWith('https://www.tikem.co')
            }
          />
        ) : embed.thumbnailUrl ? (
          <Image source={{ uri: embed.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}

        {/* Scrim + label, so the caption reads over any frame. */}
        <View pointerEvents="none" style={styles.scrim} />
        <View pointerEvents="none" style={styles.caption}>
          <Text style={styles.captionTitle}>{title}</Text>
          <View style={styles.soundChip}>
            <Ionicons name={autoplay && isFocused ? 'volume-high' : 'play'} size={14} color="#FFFFFF" />
            <Text style={styles.soundText}>
              {autoplay && isFocused ? t('eventDetail.trailer.tapForSound') : t('eventDetail.trailer.play')}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    section: { marginTop: 24 },
    // 16:9, a filled surface, the one radius.
    frame: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    web: { flex: 1, backgroundColor: '#000' },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.18)',
    },
    caption: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    captionTitle: {
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 20,
      color: '#FFFFFF',
      textTransform: 'lowercase',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowRadius: 6,
    },
    soundChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.sm,
      backgroundColor: 'rgba(0,0,0,0.7)',
    },
    soundText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  });
