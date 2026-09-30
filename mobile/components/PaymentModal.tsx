import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { X, CreditCard, Lock, Smartphone, AlertCircle, Check } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { auth } from '../config/firebase';
import { backendJson } from '../lib/api/backend';
import { useI18n } from '../contexts/I18nContext';
import WhitePillCTA from './WhitePillCTA';
import { formatCurrency } from '../lib/currency';
import { priceOrder } from '../lib/buyerPricing';
import { radius } from '../theme/tokens';
import { classifyCheckoutError, friendlyCheckoutError } from '../lib/checkoutErrors';

// Expo Go can't load native modules like Stripe. Detect it reliably via
// expo-constants. (The old `Platform.constants.expoConfig` check was always
// undefined in standalone/TestFlight builds too, so the app wrongly believed
// EVERY build was Expo Go — hiding Stripe card checkout and showing a bogus
// "not available in Expo Go" warning to real users.)
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Conditionally import Stripe only if not in Expo Go
let StripeProvider: any;
let useStripe: any;
let isPlatformPaySupported: ((params?: any) => Promise<boolean>) | null = null;

if (!isExpoGo) {
  try {
    const stripe = require('@stripe/stripe-react-native');
    StripeProvider = stripe.StripeProvider;
    useStripe = stripe.useStripe;
    isPlatformPaySupported = stripe.isPlatformPaySupported;
  } catch (error) {
    console.warn('Stripe SDK not available in Expo Go');
  }
}

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!;

/**
 * Google Pay must be told whether it is talking to Stripe test or live mode, and
 * the publishable key is the one reliable source of that in a given bundle.
 */
const STRIPE_IS_TEST_MODE = String(STRIPE_PUBLISHABLE_KEY || '').startsWith('pk_test_');

/** The wallet's own brand name — never translated. */
const WALLET_NAME = Platform.OS === 'ios' ? 'Apple Pay' : 'Google Pay';

/**
 * Apple Pay merchant identifier.
 *
 * Must match three things or the wallet button silently never appears:
 * the `com.apple.developer.in-app-payments` entitlement (written by the Stripe
 * config plugin in app.json), the Merchant ID registered in the Apple Developer
 * portal, and the merchant ID registered under Apple Pay in the Stripe Dashboard.
 */
const APPLE_PAY_MERCHANT_ID = 'merchant.co.tikem';

/**
 * Apple Pay's merchant country — the country of the MERCHANT OF RECORD, which is
 * the Tikèm platform account (Canadian), NOT the buyer's country and not the
 * event's. A US event paid in USD still declares CA here.
 */
const STRIPE_MERCHANT_COUNTRY = 'CA';

/** Where 3DS web views hand control back to the app. Matches `scheme` in app.json. */
const STRIPE_RETURN_URL = 'tikem://stripe-redirect';

// Feature flag: Sogepay (Haiti card processing) is not live yet. While disabled, Haiti events
// show only MonCash/NatCash. Flip to true to re-enable the Sogepay card option.
const SOGEPAY_ENABLED = false;

// Feature flag: launching MonCash-only — NatCash hidden for now. The handler
// and backend path stay intact; flip to true to bring the option back.
const NATCASH_ENABLED = false;

interface PaymentModalProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  userId: string;
  quantity: number;
  totalAmount: number;
  currency: string;
  country?: string;
  /** The organizer's own absorb/pass-on choice, when they made one. */
  feeIncidence?: string | null;
  tierId?: string;
  promoCodeId?: string;
  /** Promoter ref (`?ref=` on the event link) — resolved and attributed server-side. */
  refCode?: string;
  onSuccess: (paymentMethod: string, transactionId: string) => void;
}

function PaymentForm({
  eventId,
  eventTitle,
  userId,
  quantity,
  totalAmount,
  currency,
  country,
  feeIncidence,
  tierId,
  promoCodeId,
  refCode,
  onSuccess,
  onClose,
}: Omit<PaymentModalProps, 'visible'>) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  // Only use Stripe hooks if available
  const stripeHooks = useStripe
    ? useStripe()
    : { initPaymentSheet: null, presentPaymentSheet: null, retrievePaymentIntent: null };
  const { initPaymentSheet, presentPaymentSheet, retrievePaymentIntent } = stripeHooks;

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countryCode = String(country || '').toUpperCase();
  const isHaitiEvent = countryCode === 'HT' || countryCode === 'HAITI';
  // `totalAmount` is the FACE total. In a buyer-pays market the card is charged
  // that plus the service fee, so the Total row has to show the charged figure —
  // this is the last screen before payment, and it must not be the first place a
  // bigger number appears. The server recomputes the real charge; this is display.
  const orderPricing = priceOrder(
    totalAmount,
    { country, currency, fee_incidence: feeIncidence },
    { quantity }
  );
  const showFeeLine = orderPricing.feeOnTop && orderPricing.buyerFee > 0;
  // Default to MonCash if Stripe not available (Expo Go)
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'moncash' | 'natcash' | 'sogepay'>(
    isHaitiEvent ? 'moncash' : 'stripe'
  );

  // Whether to name Apple Pay on the card row.
  //
  // The wallet lives inside Stripe's sheet, which only opens after "Pay" — so a
  // row reading "Visa, Mastercard, AmEx" tells a buyer with Apple Pay set up that
  // it is not on offer, and they close the screen. A tester did exactly that.
  // Asked of the SDK rather than assumed from Platform.OS, so the label is never
  // promising a button that will not be there.
  //
  // On Android the same question covers Google Pay, and it doubles as the gate
  // for passing `googlePay` to the sheet: a build whose manifest lacks the Wallet
  // API flag (app.json `enableGooglePay`) answers false here, so the sheet is
  // simply card-only rather than erroring.
  const [walletAvailable, setWalletAvailable] = useState(false);
  // Set once the server says this organizer cannot take card payments at all, so
  // the buyer is not invited to tap Pay into the same refusal again.
  const [cardUnavailable, setCardUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!isPlatformPaySupported || isHaitiEvent) return;
    isPlatformPaySupported(
      Platform.OS === 'android' ? { googlePay: { testEnv: STRIPE_IS_TEST_MODE } } : undefined
    )
      .then((supported) => {
        if (!cancelled) setWalletAvailable(Boolean(supported));
      })
      .catch(() => {
        // Unknown means silent: a missing mention is a smaller error than a
        // promise the sheet cannot keep.
      });
    return () => {
      cancelled = true;
    };
  }, [isHaitiEvent]);

  // Stripe Payment
  const handleStripePayment = async () => {
    if (isHaitiEvent) {
      setError(t('paymentModal.errors.haitiUseSogepay'));
      return;
    }

    if (!initPaymentSheet || !presentPaymentSheet) {
      setError(t('paymentModal.errors.stripeUnavailable'));
      return;
    }
    if (cardUnavailable) {
      setError(t('paymentModal.errors.organizerCardUnavailable'));
      return;
    }
    setProcessing(true);
    setError(null);

    try {
      // Step 1: Create payment intent from your backend
      const data = await backendJson<{
        clientSecret: string;
        pricing?: { currency?: string };
      }>(`/api/create-payment-intent`, {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          quantity,
          tierId,
          promoCodeId,
          ...(refCode ? { refCode } : {}),
        }),
      });

      // Step 2: Hand the intent to Stripe's PaymentSheet. It owns the card form,
      // Apple Pay, Link and 3DS — which is why there is no card input on this
      // screen any more. iOS also offers "Scan card" inside the sheet, using the
      // camera permission declared in app.json.
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Tikèm',
        paymentIntentClientSecret: data.clientSecret,
        // The sheet hides the wallet button by itself on a device or account
        // where Apple Pay is unavailable, so this is safe to pass unconditionally.
        applePay: { merchantCountryCode: STRIPE_MERCHANT_COUNTRY },
        // Google Pay only when the device + build said yes above. Unlike Apple
        // Pay, handing the sheet a Google Pay config on a build without the
        // Wallet API manifest flag is not guaranteed to degrade quietly.
        ...(Platform.OS === 'android' && walletAvailable
          ? {
              googlePay: {
                merchantCountryCode: STRIPE_MERCHANT_COUNTRY,
                currencyCode: String(data.pricing?.currency || currency || 'USD').toUpperCase(),
                testEnv: STRIPE_IS_TEST_MODE,
              },
            }
          : {}),
        // A ticket is issued as soon as the charge clears, so a method that
        // settles days later (bank debits, Konbini) would hand out a ticket
        // before the money exists. Cards and wallets only.
        allowsDelayedPaymentMethods: false,
        returnURL: STRIPE_RETURN_URL,
        // The app has no light mode, so let the sheet match rather than follow
        // the phone and flash white over a black screen.
        style: 'alwaysDark',
        appearance: {
          colors: {
            primary: colors.primary,
            background: colors.background,
            componentBackground: colors.surface,
            componentBorder: colors.border,
            componentDivider: colors.border,
            primaryText: colors.text,
            secondaryText: colors.textSecondary,
            componentText: colors.text,
            placeholderText: colors.textTertiary,
            icon: colors.textSecondary,
            error: colors.error,
          },
          shapes: { borderRadius: radius.md },
        },
      });

      if (initError) {
        // Thrown as-is (not re-wrapped): the SDK error carries a customer-facing
        // `localizedMessage`, which the sanitizer below may use.
        throw initError;
      }

      // Step 3: Present it. Dismissing the sheet is a decision, not a failure —
      // it must leave no error text behind, or a buyer who changed their mind is
      // told something went wrong.
      const { error: sheetError } = await presentPaymentSheet();
      if (sheetError) {
        if (sheetError.code === 'Canceled') {
          setProcessing(false);
          return;
        }
        throw sheetError;
      }

      // Step 4: The sheet reports success without handing back the intent, and a
      // ticket depends on this, so read the real status from Stripe instead of
      // assuming it. The id is derivable from the client secret if that read fails.
      let paymentIntentId = data.clientSecret.split('_secret')[0];
      if (retrievePaymentIntent) {
        const { paymentIntent, error: retrieveError } = await retrievePaymentIntent(
          data.clientSecret
        );
        if (!retrieveError && paymentIntent) {
          paymentIntentId = paymentIntent.id;
          // 'Processing' is a pass: the webhook finishes those. Only an outright
          // failed or abandoned intent must not produce a ticket.
          if (
            paymentIntent.status === 'RequiresPaymentMethod' ||
            paymentIntent.status === 'Canceled'
          ) {
            throw new Error(t('paymentModal.errors.paymentFailed'));
          }
        }
      }

      // Success is announced by the caller (EventDetail.handlePaymentSuccess),
      // which shows the single success Alert and routes to Tickets. Firing our
      // own Alert here would double up, so we just hand off and close.
      onSuccess('stripe', paymentIntentId);
      onClose();
    } catch (err: any) {
      // Never render err.message: from backendJson it ends in the request URL, and
      // older servers passed Stripe's developer text (with acct_ ids) through.
      if (classifyCheckoutError(err) === 'organizer_unavailable') {
        setCardUnavailable(true);
      }
      setError(friendlyCheckoutError(err, t, 'paymentModal.errors.paymentFailed'));
    } finally {
      setProcessing(false);
    }
  };

  // Sogepay Payment (Haiti card processing)
  const handleSogepayPayment = async () => {
    setProcessing(true);
    setError(null);

    try {
      const data = await backendJson<{ redirectUrl: string }>(`/api/sogepay/initiate`, {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          quantity,
          tierId,
          promoCode: promoCodeId,
          ...(refCode ? { refCode } : {}),
        }),
      });

      if (!data.redirectUrl) {
        throw new Error(t('paymentModal.errors.missingSogepayUrl'));
      }

      onClose();
      navigation.navigate('PaymentWebView', {
        url: data.redirectUrl,
        title: t('screens.payment.complete'),
        eventId,
      });
    } catch (err: any) {
      setError(friendlyCheckoutError(err, t, 'paymentModal.errors.sogepayFailed'));
      setProcessing(false);
    }
  };

  // MonCash Payment (Haiti Mobile Money) - MerchantApi
  const handleMonCashPayment = async () => {
    setProcessing(true);
    setError(null);

    try {
      const data = await backendJson<{ redirectUrl: string }>(`/api/moncash-button/initiate`, {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          quantity,
          tierId,
          promoCode: promoCodeId,
          ...(refCode ? { refCode } : {}),
          mobileMoneyProvider: 'moncash',
          forceFormPost: true,
        }),
      });

      if (!data.redirectUrl) {
        throw new Error(t('paymentModal.errors.missingMoncashUrl'));
      }

      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      onClose();
      navigation.navigate('PaymentWebView', {
        url: data.redirectUrl,
        title: t('screens.payment.complete'),
        authToken: token,
        eventId,
      });
    } catch (err: any) {
      setError(friendlyCheckoutError(err, t, 'paymentModal.errors.moncashFailed'));
      setProcessing(false);
    }
  };

  // NatCash Payment (same backend as MonCash MerchantApi)
  const handleNatCashPayment = async () => {
    setProcessing(true);
    setError(null);

    try {
      const data = await backendJson<{ redirectUrl: string }>(`/api/moncash-button/initiate`, {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          quantity,
          tierId,
          promoCode: promoCodeId,
          ...(refCode ? { refCode } : {}),
          mobileMoneyProvider: 'natcash',
          forceFormPost: true,
        }),
      });

      if (!data.redirectUrl) {
        throw new Error(t('paymentModal.errors.missingMoncashUrl'));
      }

      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      onClose();
      navigation.navigate('PaymentWebView', {
        url: data.redirectUrl,
        title: t('screens.payment.complete'),
        authToken: token,
        eventId,
      });
    } catch (err: any) {
      setError(friendlyCheckoutError(err, t, 'paymentModal.errors.natcashFailed'));
      setProcessing(false);
    }
  };

  const handlePayment = () => {
    if (paymentMethod === 'stripe') {
      handleStripePayment();
    } else if (paymentMethod === 'sogepay') {
      handleSogepayPayment();
    } else if (paymentMethod === 'moncash') {
      handleMonCashPayment();
    } else if (paymentMethod === 'natcash') {
      handleNatCashPayment();
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>{t('screens.payment.complete')}</Text>
          <Text style={styles.headerSubtitle}>
            {quantity}x {eventTitle}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <X size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Payment Method Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('paymentModal.selectMethod')}</Text>

          {/* Stripe Card Payment - Only show if Stripe is available and not Haiti */}
          {!isHaitiEvent && !isExpoGo && StripeProvider && (
            <TouchableOpacity
              style={styles.methodRow}
              onPress={() => setPaymentMethod('stripe')}
              accessibilityRole="radio"
              accessibilityState={{ selected: paymentMethod === 'stripe' }}
            >
              <View style={styles.methodIcon}>
                <CreditCard size={20} color={paymentMethod === 'stripe' ? colors.primary : colors.textTertiary} />
              </View>
              <View style={styles.methodContent}>
                <Text
                  style={[
                    styles.methodTitle,
                    paymentMethod === 'stripe' && styles.methodTitleActive,
                  ]}
                >
                  {t('paymentModal.methods.card')}
                </Text>
                <Text
                  style={[
                    styles.methodSubtitle,
                    paymentMethod === 'stripe' && styles.methodSubtitleActive,
                  ]}
                >
                  {cardUnavailable
                    ? t('paymentModal.methods.cardUnavailable')
                    : walletAvailable
                      ? `${WALLET_NAME} · ${t('paymentModal.methods.cardBrands')}`
                      : t('paymentModal.methods.cardBrands')}
                </Text>
              </View>
              <View style={styles.methodCheck}>
                {paymentMethod === 'stripe' && <Check size={18} color={colors.primary} />}
              </View>
            </TouchableOpacity>
          )}

          {/* Sogepay Card Payment (Haiti) — hidden until Sogepay goes live */}
          {isHaitiEvent && SOGEPAY_ENABLED && (
            <TouchableOpacity
              style={styles.methodRow}
              onPress={() => setPaymentMethod('sogepay')}
              accessibilityRole="radio"
              accessibilityState={{ selected: paymentMethod === 'sogepay' }}
            >
              <View style={styles.methodIcon}>
                <CreditCard size={20} color={paymentMethod === 'sogepay' ? colors.primary : colors.textTertiary} />
              </View>
              <View style={styles.methodContent}>
                <Text
                  style={[
                    styles.methodTitle,
                    paymentMethod === 'sogepay' && styles.methodTitleActive,
                  ]}
                >
                  {t('paymentModal.methods.card')}
                </Text>
                <Text
                  style={[
                    styles.methodSubtitle,
                    paymentMethod === 'sogepay' && styles.methodSubtitleActive,
                  ]}
                >
                  {t('paymentModal.methods.sogepay')}
                </Text>
              </View>
              <View style={styles.methodCheck}>
                {paymentMethod === 'sogepay' && <Check size={18} color={colors.primary} />}
              </View>
            </TouchableOpacity>
          )}
          
          {/* Show message if in Expo Go */}
          {isExpoGo && (
            <View style={styles.expoGoWarning}>
              <AlertCircle size={18} color={colors.warning} />
              <Text style={styles.expoGoWarningText}>
                {t('paymentModal.expoGo.base')}
                {isHaitiEvent ? ` ${t('paymentModal.expoGo.haitiSuffix')}` : ''}
              </Text>
            </View>
          )}

          {/* MonCash (Haiti only) */}
          {isHaitiEvent && (
            <TouchableOpacity
              style={styles.methodRow}
              onPress={() => setPaymentMethod('moncash')}
              accessibilityRole="radio"
              accessibilityState={{ selected: paymentMethod === 'moncash' }}
            >
              <View style={styles.methodIcon}>
                <Smartphone size={20} color={paymentMethod === 'moncash' ? colors.primary : colors.textTertiary} />
              </View>
              <View style={styles.methodContent}>
                <Text
                  style={[
                    styles.methodTitle,
                    paymentMethod === 'moncash' && styles.methodTitleActive,
                  ]}
                >
                  {t('paymentModal.methods.moncash')}
                </Text>
                <Text
                  style={[
                    styles.methodSubtitle,
                    paymentMethod === 'moncash' && styles.methodSubtitleActive,
                  ]}
                >
                  {t('paymentModal.methods.haitiMobileMoney')}
                </Text>
              </View>
              <View style={styles.methodCheck}>
                {paymentMethod === 'moncash' && <Check size={18} color={colors.primary} />}
              </View>
            </TouchableOpacity>
          )}

          {/* NatCash (Haiti only) */}
          {isHaitiEvent && NATCASH_ENABLED && (
            <TouchableOpacity
              style={styles.methodRow}
              onPress={() => setPaymentMethod('natcash')}
              accessibilityRole="radio"
              accessibilityState={{ selected: paymentMethod === 'natcash' }}
            >
              <View style={styles.methodIcon}>
                <Smartphone size={20} color={paymentMethod === 'natcash' ? colors.primary : colors.textTertiary} />
              </View>
              <View style={styles.methodContent}>
                <Text
                  style={[
                    styles.methodTitle,
                    paymentMethod === 'natcash' && styles.methodTitleActive,
                  ]}
                >
                  {t('paymentModal.methods.natcash')}
                </Text>
                <Text
                  style={[
                    styles.methodSubtitle,
                    paymentMethod === 'natcash' && styles.methodSubtitleActive,
                  ]}
                >
                  {t('paymentModal.methods.haitiMobileMoney')}
                </Text>
              </View>
              <View style={styles.methodCheck}>
                {paymentMethod === 'natcash' && <Check size={18} color={colors.primary} />}
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* No card fields here on purpose: Stripe's PaymentSheet collects the
            card, offers Apple Pay and Link, and handles 3DS once "Pay" is
            tapped. The __DEV__ test-card hint went with it — the sheet shows
            saved and scanned cards of its own. */}

        {/* Mobile Money redirect hint — quiet inline helper text, never a boxed callout */}
        {(paymentMethod === 'moncash' || paymentMethod === 'natcash') && (
          <Text style={styles.infoText} numberOfLines={2}>
            {t('paymentModal.info.redirectPrefix')}
            {paymentMethod === 'moncash'
              ? t('paymentModal.methods.moncash')
              : t('paymentModal.methods.natcash')}
            {t('paymentModal.info.redirectSuffix')}
          </Text>
        )}

        {/* Error Message */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Total Amount — itemized when the buyer is carrying the service fee, so
            the number is explained rather than merely larger. */}
        {showFeeLine && (
          <View style={styles.feeBreakdown}>
            <View style={styles.feeRow}>
              <Text style={styles.feeRowLabel}>{t('paymentModal.subtotal')}</Text>
              <Text style={styles.feeRowValue}>
                {formatCurrency(orderPricing.faceValue, currency)}
              </Text>
            </View>
            <View style={styles.feeRow}>
              <Text style={styles.feeRowLabel}>
                {t('paymentModal.serviceFee')}
              </Text>
              <Text style={styles.feeRowValue}>
                {formatCurrency(orderPricing.buyerFee, currency)}
              </Text>
            </View>
          </View>
        )}
        <View style={[styles.totalContainer, showFeeLine && styles.totalContainerAttached]}>
          <Text style={styles.totalLabel}>{t('paymentModal.totalAmount')}</Text>
          <Text style={styles.totalAmount}>
            {formatCurrency(orderPricing.total, currency)}
          </Text>
        </View>

        {/* Security Badge */}
        <View style={styles.securityBadge}>
          <Lock size={14} color={colors.textSecondary} />
          <Text style={styles.securityText}>{t('paymentModal.securedBy')}</Text>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onClose}
          disabled={processing}
        >
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>

        {/* The amount lives in the Total row above — repeating it on the button
            read as unpolished to testers, so the CTA is just the verb. */}
        <WhitePillCTA
          variant="paid"
          style={styles.payButtonPill}
          label={t('paymentModal.pay')}
          loading={processing}
          disabled={processing || (paymentMethod === 'stripe' && cardUnavailable)}
          onPress={handlePayment}
        />
      </View>
    </View>
  );
}

export default function PaymentModal(props: PaymentModalProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = getStyles(colors);

  // Haiti events pay via MonCash/NatCash and never touch Stripe, so they must
  // render the plain form even when the Stripe SDK/key is absent — otherwise a
  // missing publishable key would wrongly block Haitian checkout below.
  const isHaitiEvent = ['HT', 'HAITI'].includes(String(props.country || '').toUpperCase());

  // If it's a Haiti event, we're in Expo Go, or Stripe isn't available, render
  // without StripeProvider.
  if (isHaitiEvent || isExpoGo || !StripeProvider) {
    return (
      <Modal
        visible={props.visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={props.onClose}
      >
        <PaymentForm {...props} />
      </Modal>
    );
  }

  if (!STRIPE_PUBLISHABLE_KEY) {
    // The env var name is for us, not the buyer: it goes to the log only.
    console.warn('[PaymentModal] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set in this bundle');
    return (
      <Modal
        visible={props.visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={props.onClose}
      >
        <View style={styles.container}>
          <View style={styles.errorContainer}>
            <AlertCircle size={48} color={colors.error} />
            <Text style={styles.errorText}>
              {t('paymentModal.stripeMissingKey')}
            </Text>
            <TouchableOpacity style={styles.payButton} onPress={props.onClose}>
              <Text style={styles.payButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <StripeProvider
        publishableKey={STRIPE_PUBLISHABLE_KEY}
        // Apple Pay renders ONLY when the provider knows the merchant id; without
        // it the sheet quietly falls back to card-only with no error anywhere.
        merchantIdentifier={APPLE_PAY_MERCHANT_ID}
        // Lets the SDK return from a 3DS web view without stranding the buyer.
        urlScheme="tikem"
      >
        <PaymentForm {...props} />
      </StripeProvider>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 20,
  },
  // Quiet overline so the method rows themselves are the loudest thing here.
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    marginBottom: 4,
  },
  // Payment methods read as plain rows on the black canvas — no tinted card, no
  // heavy border, no filled icon chip. Selection is carried by a teal check plus
  // full-strength label text, with unselected rows sitting back a step.
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  methodIcon: {
    width: 26,
    alignItems: 'center',
    marginRight: 14,
  },
  methodContent: {
    flex: 1,
  },
  methodTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 1,
  },
  methodTitleActive: {
    color: colors.text,
  },
  methodSubtitle: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  methodSubtitleActive: {
    color: colors.textSecondary,
  },
  methodCheck: {
    width: 20,
    alignItems: 'flex-end',
  },
  infoText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 10,
  },
  errorContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: colors.error + '15',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    textAlign: 'center',
  },
  // Subtotal + fee rows, shown only when the buyer carries the fee. They sit
  // above the total and own the top rule, so the total row drops its own.
  feeBreakdown: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
  },
  feeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  feeRowLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  feeRowValue: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  totalContainer: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // When the breakdown is above, it already drew the rule — the total belongs to
  // the same block rather than starting a second one.
  totalContainerAttached: {
    marginTop: 10,
    paddingTop: 0,
    borderTopWidth: 0,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  totalAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 24,
  },
  securityText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  payButton: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payButtonPill: {
    flex: 2,
  },
  payButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  expoGoWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    marginBottom: 12,
  },
  expoGoWarningText: {
    flex: 1,
    fontSize: 14,
    color: '#FCD34D',
    lineHeight: 20,
  },
});
