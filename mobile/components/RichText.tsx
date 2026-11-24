import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { parseRichText, type RichSpan } from '../lib/richText';

/**
 * An event description with its light formatting (**bold**, *italic*, "- "
 * bullets, "1. " numbers; lib/richText). Plain nested <Text>, no HTML or
 * WebView, so an organizer's text can only ever be text.
 */
function Spans({ spans }: { spans: RichSpan[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.bold || s.italic ? (
          <Text key={i} style={[s.bold && styles.bold, s.italic && styles.italic]}>
            {s.text}
          </Text>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ),
      )}
    </>
  );
}

export default function RichText({
  text,
  style,
  selectable,
}: {
  text: unknown;
  /** The body text style (size, colour, line height). */
  style?: StyleProp<TextStyle>;
  selectable?: boolean;
}) {
  const blocks = parseRichText(typeof text === 'string' ? text.trim() : text);
  if (!blocks.length) return null;
  return (
    <View>
      {blocks.map((b, i) => {
        const gap = i === 0 ? null : styles.blockGap;
        if (b.type === 'paragraph') {
          return (
            <Text key={i} style={[style, gap]} selectable={selectable}>
              {b.lines.map((line, j) => (
                <React.Fragment key={j}>
                  {j > 0 ? '\n' : null}
                  <Spans spans={line} />
                </React.Fragment>
              ))}
            </Text>
          );
        }
        return (
          <View key={i} style={[gap, styles.list]}>
            {b.items.map((it, j) => (
              <View key={j} style={styles.item}>
                <Text style={[style, styles.marker]} importantForAccessibility="no">
                  {b.type === 'bullets' ? '•' : `${b.start + j}.`}
                </Text>
                <Text style={[style, styles.itemText]} selectable={selectable}>
                  <Spans spans={it} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  blockGap: { marginTop: 10 },
  list: { gap: 4 },
  // flexDirection 'row' mirrors itself under RTL, so the marker sits on the reading side.
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  marker: { minWidth: 18, paddingEnd: 6, textAlign: 'auto' },
  itemText: { flex: 1 },
});
