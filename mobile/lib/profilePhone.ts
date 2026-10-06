/**
 * The profile phone field: split a stored number into (dial code, national
 * part) for editing, and compose the E.164 value to store.
 *
 * The bug this exists to fix (TestFlight, 2026-10-06): a US number stored
 * without its `+1` ("7654076400") came back under the +509 chip, because the
 * old parser treated anything without a recognised `+` prefix as Haitian. A
 * save from that screen then wrote `+5097654076400`, a number that does not
 * exist. So:
 *
 *  - a value with a `+` (or `00`) is authoritative: the longest dial code that
 *    matches wins (+590 is not +59 and a stray 0);
 *  - a bare value is read by its LENGTH first. A Haitian national number is
 *    exactly 8 digits; a NANP number is 10 (or 11 with its leading 1); a
 *    French one is 10 with a trunk 0. Those shapes do not overlap, so the
 *    length decides before any default does;
 *  - only a value that matches none of those falls back to the account's
 *    country, and then to Haiti.
 *
 * Mirrors the web's lib/phoneCountries (fromE164 / toE164) so both clients
 * store the same canonical `+<dial><national>`.
 */

/** Chips always offered, in this order. */
export const PRIMARY_DIALS = ['509', '1', '33'] as const;

// Every dial code the web picker knows (lib/phoneCountries), deduplicated, so
// a stored +44 or +590 number is split correctly instead of being mangled.
const KNOWN_DIALS = [
  '1', '20', '27', '30', '31', '32', '33', '34', '39', '40', '41', '43', '44', '45', '46', '47',
  '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '61', '62', '63', '64', '65', '81',
  '84', '86', '90', '91', '212', '221', '223', '224', '225', '226', '228', '229', '233', '234',
  '237', '242', '243', '251', '254', '255', '256', '261', '297', '351', '352', '353', '358', '501',
  '502', '503', '504', '505', '506', '507', '509', '590', '591', '592', '593', '594', '595', '596',
  '597', '598', '599', '961', '971', '972',
];
const BY_LENGTH = [...KNOWN_DIALS].sort((a, b) => b.length - a.length);

const COUNTRY_DIAL: Record<string, string> = { HT: '509', US: '1', CA: '1', DO: '1', PR: '1', FR: '33' };

export interface SplitPhone {
  /** Dial code, digits only, no plus ("509", "1", "33"…). */
  dial: string;
  /** National significant number, digits only. */
  national: string;
}

const digitsOnly = (s: string) => (s || '').replace(/\D+/g, '');

/** The dial code to start an empty field on: the profile's country, else Haiti. */
export function defaultDialFor(countryIso?: string | null): string {
  return COUNTRY_DIAL[(countryIso || '').toUpperCase()] || '509';
}

/** Split a stored phone_number (E.164 or legacy free text) for editing. */
export function splitStoredPhone(raw: string | null | undefined, countryIso?: string | null): SplitPhone {
  const text = (raw || '').trim();
  const fallback = defaultDialFor(countryIso);
  if (!text) return { dial: fallback, national: '' };

  const international = text.startsWith('+') || text.startsWith('00');
  let digits = digitsOnly(text);
  if (international) {
    if (text.startsWith('00')) digits = digits.slice(2);
    for (const d of BY_LENGTH) {
      if (digits.startsWith(d) && digits.length > d.length) return { dial: d, national: digits.slice(d.length) };
    }
    return { dial: fallback, national: digits };
  }

  // Bare digits: decide by shape before any default.
  if (digits.length === 8) return { dial: '509', national: digits };
  if (digits.length === 11 && digits.startsWith('509')) return { dial: '509', national: digits.slice(3) };
  if (digits.length === 10 && digits.startsWith('0') && fallback === '33') {
    return { dial: '33', national: digits.slice(1) };
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return { dial: '1', national: digits };
  if (digits.length === 11 && digits.startsWith('1')) return { dial: '1', national: digits.slice(1) };
  return { dial: fallback, national: digits };
}

/**
 * The value to store: `+<dial><national>`, or '' when the national part is
 * empty (a bare "+509" is not a number). Cleans the usual pastes: a repeated
 * dial code, a NANP leading 1, a French trunk 0.
 */
export function composeStoredPhone(dial: string, national: string): string {
  const d = digitsOnly(dial);
  let n = digitsOnly(national);
  if (!d || !n) return '';
  if (n.startsWith(d) && n.length > d.length + 5) n = n.slice(d.length);
  if (d === '1' && n.length === 11 && n.startsWith('1')) n = n.slice(1);
  if (d === '33' && n.startsWith('0')) n = n.slice(1);
  return n ? `+${d}${n}` : '';
}

/**
 * Interpret a keystroke or paste in the national box. A `+` in the text means
 * the whole number was pasted: re-derive both parts so the chip follows it.
 */
export function readTypedPhone(text: string, currentDial: string): SplitPhone {
  if ((text || '').includes('+')) {
    const parsed = splitStoredPhone(`+${digitsOnly(text)}`);
    if (parsed.national) return parsed;
  }
  return { dial: currentDial, national: digitsOnly(text) };
}
