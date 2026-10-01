import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { colors as T } from '../../theme/tokens';

export interface DailyPoint {
  /** YYYY-MM-DD */
  date: string;
  count: number;
}

interface Props {
  /** Days that had sales (sparse, as the API returns them). */
  points: DailyPoint[];
  /** Format a YYYY-MM-DD key for the axis (locale-aware, from the screen). */
  formatDay: (date: string) => string;
  /** Most days to plot, counting back from the last sale. */
  maxDays?: number;
  height?: number;
}

const DAY_MS = 86_400_000;

/** Sparse sale days → one bar per calendar day, gaps filled with zero. */
export function fillDays(points: DailyPoint[], maxDays: number): DailyPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((p) => [p.date, p.count]));
  const end = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`);
  const first = Date.parse(`${sorted[0].date}T00:00:00Z`);
  const start = Math.max(first, end - (maxDays - 1) * DAY_MS);
  const out: DailyPoint[] = [];
  for (let ts = start; ts <= end; ts += DAY_MS) {
    const key = new Date(ts).toISOString().slice(0, 10);
    out.push({ date: key, count: byDate.get(key) || 0 });
  }
  return out;
}

/**
 * Tickets sold per day, drawn with react-native-svg. Same voice as the
 * organizer-wide analytics chart: teal bars, the best day at full strength and
 * every other day dimmed, a hairline baseline, and only the first / last day
 * labelled so the axis never crowds.
 */
export default function DailySalesChart({ points, formatDay, maxDays = 30, height = 132 }: Props) {
  const [width, setWidth] = useState(0);
  const days = useMemo(() => fillDays(points, maxDays), [points, maxDays]);
  const max = Math.max(1, ...days.map((d) => d.count));
  const peakIndex = days.findIndex((d) => d.count === max);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const topPad = 18; // room for the peak's value label
  const plotH = height - topPad;
  const gap = days.length > 20 ? 3 : 6;
  const barW = days.length > 0 ? Math.min(24, Math.max(3, (width - gap * (days.length - 1)) / days.length)) : 0;
  const totalW = days.length * barW + (days.length - 1) * gap;
  const offsetX = Math.max(0, (width - totalW) / 2);

  return (
    <View onLayout={onLayout}>
      {width > 0 && days.length > 0 ? (
        <Svg width={width} height={height}>
          {days.map((d, i) => {
            const h = d.count > 0 ? Math.max(4, (d.count / max) * (plotH - 4)) : 2;
            const x = offsetX + i * (barW + gap);
            const isPeak = i === peakIndex;
            return (
              <Rect
                key={d.date}
                x={x}
                y={height - h}
                width={barW}
                height={h}
                rx={Math.min(4, barW / 2)}
                fill={d.count > 0 ? T.teal : T.border}
                opacity={d.count > 0 && !isPeak ? 0.38 : 1}
              />
            );
          })}
          {peakIndex >= 0 ? (
            <SvgText
              x={offsetX + peakIndex * (barW + gap) + barW / 2}
              y={height - Math.max(4, plotH - 4) - 6}
              fill={T.teal}
              fontSize={11}
              fontWeight="700"
              textAnchor="middle"
            >
              {String(max)}
            </SvgText>
          ) : null}
          <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={T.border} strokeWidth={StyleSheet.hairlineWidth} />
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      {days.length > 0 ? (
        <View style={styles.axis}>
          <Text style={styles.axisLabel}>{formatDay(days[0].date)}</Text>
          {days.length > 1 ? <Text style={styles.axisLabel}>{formatDay(days[days.length - 1].date)}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  axisLabel: {
    fontSize: 11,
    color: T.textTertiary,
    fontVariant: ['tabular-nums'],
  },
});
