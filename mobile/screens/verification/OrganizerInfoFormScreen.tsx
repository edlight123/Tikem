import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import {
  updateVerificationStep,
  getVerificationRequest,
} from '../../lib/verification';
import { useAppAlert } from '../../components/AppAlert';
import { radius } from '../../theme/tokens';

type RouteParams = {
  OrganizerInfoForm: {
    onComplete?: () => void;
  };
};

export default function OrganizerInfoFormScreen() {
  const { colors, isDark } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'OrganizerInfoForm'>>();
  const { userProfile } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationType, setOrganizationType] = useState('individual');
  const [description, setDescription] = useState('');

  useEffect(() => {
    loadExistingData();
  }, [userProfile?.id]);

  const loadExistingData = async () => {
    if (!userProfile?.id) return;

    try {
      const request = await getVerificationRequest(userProfile.id);
      if (request?.steps?.organizerInfo?.fields) {
        const fields = request.steps.organizerInfo.fields;
        setFullName(fields.full_name || userProfile?.full_name || '');
        setPhone(fields.phone || userProfile?.phone_number || '');
        setOrganizationName(fields.organization_name || '');
        setOrganizationType(fields.organization_type || 'individual');
        setDescription(fields.description || '');
      } else {
        // Set defaults from profile
        setFullName(userProfile?.full_name || '');
        setPhone(userProfile?.phone_number || '');
      }
    } catch (error) {
      console.error('Error loading existing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const validate = () => {
    if (!fullName.trim()) {
      showAlert(t('verification.organizerInfo.validation.missingTitle'), t('verification.organizerInfo.validation.fullName'));
      return false;
    }
    if (!phone.trim()) {
      showAlert(t('verification.organizerInfo.validation.missingTitle'), t('verification.organizerInfo.validation.phone'));
      return false;
    }
    if (!organizationName.trim()) {
      showAlert(t('verification.organizerInfo.validation.missingTitle'), t('verification.organizerInfo.validation.organizationName'));
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!userProfile?.id) return;

    try {
      setSaving(true);

      await updateVerificationStep(userProfile.id, 'organizerInfo', {
        status: 'complete',
        fields: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          organization_name: organizationName.trim(),
          organization_type: organizationType,
          description: description.trim(),
        },
        missingFields: [],
      });

      showAlert(t('common.success'), t('verification.organizerInfo.savedSuccessfully'), [
        {
          text: t('common.ok'),
          onPress: () => {
            if (route.params?.onComplete) {
              route.params.onComplete();
            }
            navigation.goBack();
          },
        },
      ]);
    } catch (error) {
      console.error('Error saving:', error);
      showAlert(t('common.error'), t('verification.organizerInfo.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={isDark ? colors.surface : colors.white} />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('verification.organizerInfo.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.sectionDescription}>
          {t('verification.organizerInfo.subtitle')}
        </Text>

        {/* Full Name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>
            {t('verification.organizerInfo.fields.fullName')} <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder={t('verification.organizerInfo.placeholders.fullName')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
          />
        </View>

        {/* Phone */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>
            {t('verification.organizerInfo.fields.phone')} <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('verification.organizerInfo.placeholders.phone')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            keyboardType="phone-pad"
          />
        </View>

        {/* Organization Name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>
            {t('verification.organizerInfo.fields.organizationName')} <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={organizationName}
            onChangeText={setOrganizationName}
            placeholder={t('verification.organizerInfo.placeholders.organizationName')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
          />
        </View>

        {/* Organization Type */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('verification.organizerInfo.fields.organizationType')}</Text>
          <View style={styles.radioGroup}>
            <TouchableOpacity
              style={[
                styles.radioButton,
                organizationType === 'individual' && styles.radioButtonSelected,
              ]}
              onPress={() => setOrganizationType('individual')}
            >
              <View style={styles.radio}>
                {organizationType === 'individual' && <View style={styles.radioInner} />}
              </View>
              <Text style={styles.radioLabel}>{t('verification.organizerInfo.organizationTypes.individual')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.radioButton,
                organizationType === 'business' && styles.radioButtonSelected,
              ]}
              onPress={() => setOrganizationType('business')}
            >
              <View style={styles.radio}>
                {organizationType === 'business' && <View style={styles.radioInner} />}
              </View>
              <Text style={styles.radioLabel}>{t('verification.organizerInfo.organizationTypes.business')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Description */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('verification.organizerInfo.fields.descriptionOptional')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('verification.organizerInfo.placeholders.description')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>{t('verification.common.saveAndContinue')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 24,
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  required: {
    color: colors.error,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.text,
  },
  textArea: {
    height: 100,
    paddingTop: 12,
  },
  radioGroup: {
    flexDirection: 'row',
    gap: 12,
  },
  radioButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 12,
  },
  radioButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    fontSize: 14,
    color: colors.text,
  },
  footer: {
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveButton: {
    backgroundColor: colors.primary,
    minHeight: 56,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
