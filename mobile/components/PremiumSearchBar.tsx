import React from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Search } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';

interface PremiumSearchBarProps {
  onPress: () => void;
}

export default function PremiumSearchBar({ onPress }: PremiumSearchBarProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.searchBar}>
        <Search size={20} color={colors.textTertiary} style={styles.icon} />
        <TextInput
          style={styles.input}
          placeholder="Search events, organizers, or cities"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          editable={false}
          pointerEvents="none"
        />
      </View>
    </TouchableOpacity>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
  },
  icon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
});
