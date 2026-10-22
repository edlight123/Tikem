'use client';

import { useTranslation } from 'react-i18next'

import { useState, useMemo } from 'react';
import { MapPin, Globe, Clock, DollarSign, Tag, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { LOCATION_CONFIG, getCitiesForCountry } from '@/lib/filters/config';

interface DefaultsFormProps {
  userId: string;
  initialData: {
    default_city: string;
    default_country: string;
    default_timezone: string;
    default_currency: string;
    default_categories: string[];
  };
}

const CATEGORIES = [
  'Music', 'Arts & Culture', 'Sports', 'Food & Drink', 'Business',
  'Education', 'Charity', 'Community', 'Family', 'Technology'
];

const TIMEZONES = [
  { value: 'America/Port-au-Prince', label: 'Haiti Time (EST)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
];

const CURRENCIES = [
  { value: 'HTG', label: 'Haitian Gourde (HTG)', symbol: 'G' },
  { value: 'USD', label: 'US Dollar (USD)', symbol: '$' },
];

export default function DefaultsForm({ userId, initialData }: DefaultsFormProps) {
  const { t } = useTranslation('organizer')

  const [formData, setFormData] = useState(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  // Get cities for selected country
  const cities = useMemo(() => {
    return getCitiesForCountry(formData.default_country || 'HT');
  }, [formData.default_country]);

  // Get list of countries
  const countries = useMemo(() => {
    return Object.values(LOCATION_CONFIG).map(country => ({
      code: country.code,
      name: country.name
    }));
  }, []);

  const handleCountryChange = (countryCode: string) => {
    setFormData({
      ...formData,
      default_country: countryCode,
      default_city: '', // Reset city when country changes
    });
  };

  const handleCategoryToggle = (category: string) => {
    setFormData((prev) => ({
      ...prev,
      default_categories: prev.default_categories.includes(category)
        ? prev.default_categories.filter((c) => c !== category)
        : [...prev.default_categories, category],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/organizer/settings/defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to update defaults');
      }

      showToast({
        title: 'Defaults updated',
        message: 'Your event defaults have been successfully updated.',
        type: 'success',
      });
    } catch (error) {
      console.error('Error updating defaults:', error);
      showToast({
        title: 'Error',
        message: 'Failed to update defaults. Please try again.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6">
      {/* Location */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Country */}
        <div>
          <label htmlFor="default_country" className="block text-sm font-medium text-white/70 mb-2">
            {t('defaults_form.default_country')}
          </label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
            <select
              id="default_country"
              value={formData.default_country}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded focus:ring-2 focus:ring-brand-500 appearance-none bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
            >
              <option value="">{t('defaults_form.select_a_country')}</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* City */}
        <div>
          <label htmlFor="default_city" className="block text-sm font-medium text-white/70 mb-2">
            {t('defaults_form.default_city')}
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
            <select
              id="default_city"
              value={formData.default_city}
              onChange={(e) => setFormData({ ...formData, default_city: e.target.value })}
              className="w-full pl-10 pr-4 py-3 rounded focus:ring-2 focus:ring-brand-500 appearance-none bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
              disabled={!formData.default_country}
            >
              <option value="">{t('defaults_form.select_a_city')}</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
          {!formData.default_country && (
            <p className="text-xs text-white/50 mt-1">{t('defaults_form.select_country_first')}</p>
          )}
        </div>
      </div>

      {/* Timezone */}
      <div>
        <label htmlFor="default_timezone" className="block text-sm font-medium text-white/70 mb-2">
          {t('defaults_form.default_timezone')}
        </label>
        <div className="relative">
          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <select
            id="default_timezone"
            value={formData.default_timezone}
            onChange={(e) => setFormData({ ...formData, default_timezone: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded focus:ring-2 focus:ring-brand-500 appearance-none bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Currency */}
      <div>
        <label htmlFor="default_currency" className="block text-sm font-medium text-white/70 mb-2">
          {t('defaults_form.default_currency')}
        </label>
        <div className="relative">
          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <select
            id="default_currency"
            value={formData.default_currency}
            onChange={(e) => setFormData({ ...formData, default_currency: e.target.value })}
            className="w-full pl-10 pr-4 py-3 rounded focus:ring-2 focus:ring-brand-500 appearance-none bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
          >
            {CURRENCIES.map((currency) => (
              <option key={currency.value} value={currency.value}>
                {currency.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Categories */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-3">
          <Tag className="inline w-4 h-4 mr-1" />
          {t('defaults_form.default_categories')}
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => handleCategoryToggle(category)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                formData.default_categories.includes(category)
                  ? 'bg-white text-black'
                  : 'bg-white/[0.055] text-white/70 hover:bg-white/[0.12] hover:text-white'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/50 mt-2">
          {t('defaults_form.categories_help')}
        </p>
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-4 border-t border-white/10">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2.5 bg-white hover:bg-white/90 text-black font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? 'Saving...' : 'Save Defaults'}
        </button>
      </div>
    </form>
  );
}
