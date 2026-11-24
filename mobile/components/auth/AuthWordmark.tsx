import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { TikemWordmark } from '../TikemWordmark';

/** The wordmark, centred on the sign-in canvas (no chip: there is no photo behind it any more). */
export function AuthWordmark({ size = 40, style }: { size?: number; style?: ViewStyle }) {
  return (
    <View style={[styles.chip, style]}>
      <TikemWordmark fontSize={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'center',
    paddingBottom: 4,
  },
});

export default AuthWordmark;
