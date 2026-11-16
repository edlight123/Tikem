/**
 * The platform switch, themed: teal when on, a raised grey track when off, and
 * a selection haptic on change. Use this instead of hand-drawn toggles.
 */
import React from 'react';
import { Platform, Switch as RNSwitch, type SwitchProps as RNSwitchProps } from 'react-native';
import { colors as T } from '../../theme/tokens';
import { select } from '../../lib/haptics';

export function Switch({ value, onValueChange, disabled, ...rest }: RNSwitchProps) {
  return (
    <RNSwitch
      {...rest}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        select();
        onValueChange?.(v);
      }}
      trackColor={{ false: '#3A3A3C', true: T.teal }}
      thumbColor={Platform.OS === 'android' ? (value ? '#FFFFFF' : '#D4D4D4') : undefined}
      ios_backgroundColor="#3A3A3C"
    />
  );
}

export default Switch;
