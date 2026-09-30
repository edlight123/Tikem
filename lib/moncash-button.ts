import crypto from 'crypto'

// Bump to confirm deployments in logs (no secrets).
const MONCASH_BUTTON_HELPER_VERSION = '2025-12-19i'

const MONCASH_SANDBOX_URL = 'https://sandbox.moncashbutton.digicelgroup.com'
const MONCASH_PRODUCTION_URL = 'https://moncashbutton.digicelgroup.com'

function getMonCashMode(): 'sandbox' | 'production' {
  const mode = (process.env.MONCASH_BUTTON_MODE || process.env.MONCASH_MODE || 'sandbox').toLowerCase()
  return mode === 'production' ? 'production' : 'sandbox'
}

function getMonCashFormMode(): 'sandbox' | 'production' {
  const mode = (process.env.MONCASH_BUTTON_FORM_MODE || process.env.MONCASH_BUTTON_MODE || process.env.MONCASH_MODE || 'sandbox').toLowerCase()
  return mode === 'production' ? 'production' : 'sandbox'
}

function isButtonModeExplicit(): boolean {
  return typeof process.env.MONCASH_BUTTON_MODE === 'string' && process.env.MONCASH_BUTTON_MODE.length > 0
}

function isRsaPaddingExplicit(): boolean {
  return (
    typeof process.env.MONCASH_BUTTON_RSA_PADDING === 'string' && process.env.MONCASH_BUTTON_RSA_PADDING.length > 0
  )
}

function getMonCashButtonHost(): string {
  return getMonCashMode() === 'production' ? MONCASH_PRODUCTION_URL : MONCASH_SANDBOX_URL
}

function getMonCashButtonHostForMode(mode: 'sandbox' | 'production'): string {
  return mode === 'production' ? MONCASH_PRODUCTION_URL : MONCASH_SANDBOX_URL
}

function getMonCashMiddlewareBaseUrlForMode(mode: 'sandbox' | 'production'): string {
  return `${getMonCashButtonHostForMode(mode)}/Moncash-middleware`
}

function getMonCashMiddlewareBaseUrl(): string {
  return `${getMonCashButtonHost()}/Moncash-middleware`
}

function normalizePem(pem: string): string {
  // Vercel env vars often store PEMs with literal "\n"
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem
}

function parseMonCashPublicKeyFromEnv(value: string): crypto.KeyObject {
  const normalized = normalizePem(value).trim()

  // If it's already PEM (either PUBLIC KEY or RSA PUBLIC KEY), let Node parse it.
  if (normalized.includes('BEGIN')) {
    return crypto.createPublicKey(normalized)
  }

  // Otherwise, treat as base64 DER and try common public key containers.
  const der = Buffer.from(normalized.replace(/\s+/g, ''), 'base64')

  // 1) SPKI (matches the Java X509EncodedKeySpec example)
  try {
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    // 2) PKCS#1 RSAPublicKey (matches phpseclib CRYPT_RSA_PUBLIC_FORMAT_PKCS1 usage)
    return crypto.createPublicKey({ key: der, format: 'der', type: 'pkcs1' })
  }
}

function parseMonCashPrivateKeyFromEnv(value: string): crypto.KeyObject {
  const normalized = normalizePem(value).trim()

  // If it's PEM (PRIVATE KEY or RSA PRIVATE KEY), let Node parse it.
  if (normalized.includes('BEGIN')) {
    return crypto.createPrivateKey(normalized)
  }

  // Otherwise treat as base64 DER. Try common private key containers.
  const der = Buffer.from(normalized.replace(/\s+/g, ''), 'base64')
  try {
    // PKCS#8
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  } catch {
    // PKCS#1
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs1' })
  }
}

function getMonCashButtonKeyPem(): string {
  // Digicel docs call this the "Secret API KEY". In practice it is usually a PEM key.
  const key = (process.env.MONCASH_BUTTON_SECRET_API_KEY || '').trim()
  if (!key) {
    throw new Error('MONCASH_BUTTON_SECRET_API_KEY is not configured')
  }
  const keyObject = parseMonCashPublicKeyFromEnv(key)
  // Normalize to a stable PEM for downstream uses.
  return keyObject.export({ format: 'pem', type: 'spki' }).toString()
}

function getMonCashButtonPrivateKeyPemMaybe(): string | null {
  // Prefer explicit private key env var if present (keeps public encryption key separate).
  const raw = (process.env.MONCASH_BUTTON_PRIVATE_KEY || process.env.MONCASH_BUTTON_SECRET_API_KEY || '').trim()
  if (!raw) return null
  try {
    const keyObject = parseMonCashPrivateKeyFromEnv(raw)
    return keyObject.export({ format: 'pem', type: 'pkcs8' }).toString()
  } catch {
    return null
  }
}

function getMonCashFormKeyPem(): string {
  const key = (process.env.MONCASH_BUTTON_FORM_SECRET_API_KEY || process.env.MONCASH_BUTTON_SECRET_API_KEY || '').trim()
  if (!key) {
    throw new Error('MONCASH_BUTTON_SECRET_API_KEY is not configured')
  }
  const keyObject = parseMonCashPublicKeyFromEnv(key)
  return keyObject.export({ format: 'pem', type: 'spki' }).toString()
}

function getMonCashFormPrivateKeyPemMaybe(): string | null {
  const raw = (
    process.env.MONCASH_BUTTON_FORM_PRIVATE_KEY ||
    process.env.MONCASH_BUTTON_FORM_SECRET_API_KEY ||
    process.env.MONCASH_BUTTON_SECRET_API_KEY ||
    ''
  ).trim()
  if (!raw) return null
  try {
    const keyObject = parseMonCashPrivateKeyFromEnv(raw)
    return keyObject.export({ format: 'pem', type: 'pkcs8' }).toString()
  } catch {
    return null
  }
}

function decodeBase64OrBase64UrlToBuffer(value: string): Buffer | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  try {
    return Buffer.from(padded, 'base64')
  } catch {
    return null
  }
}

export function buildTokenVariants(token: string): string[] {
  const raw = String(token || '').trim()
  if (!raw) return []

  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()

  const stripPadding = (v: string) => v.replace(/=+$/g, '')
  const toBase64 = (v: string) => v.replace(/-/g, '+').replace(/_/g, '/')
  const toBase64Url = (v: string) => v.replace(/\+/g, '-').replace(/\//g, '_')

  const candidates = [
    raw,
    decoded,
    stripPadding(raw),
    stripPadding(decoded),
    toBase64(raw),
    toBase64(decoded),
    stripPadding(toBase64(raw)),
    stripPadding(toBase64(decoded)),
    toBase64Url(raw),
    toBase64Url(decoded),
    stripPadding(toBase64Url(raw)),
    stripPadding(toBase64Url(decoded)),
  ]

  return Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)))
}

function maybeDecodeReturnTransactionIdWithoutKey(encryptedTransactionId: string): string | null {
  // Some Digicel environments appear to return a value that is only base64/base64url encoded
  // (or otherwise doesn't require private-key decryption).
  // Try decoding and extracting a plausible token/id.
  const buf = decodeBase64OrBase64UrlToBuffer(encryptedTransactionId)
  if (!buf) return null

  const utf8 = stripNonPrintableAndNulls(buf.toString('utf8'))
  if (looksLikeDecryptedTransactionId(utf8)) return utf8

  const latin1 = stripNonPrintableAndNulls(buf.toString('latin1'))
  if (looksLikeDecryptedTransactionId(latin1)) return latin1

  const extracted = extractAsciiTokenFromBytes(buf)
  if (extracted && looksLikeDecryptedTransactionId(extracted)) return extracted

  return null
}

function stripNonPrintableAndNulls(text: string): string {
  // Remove null padding + trim; keep conservative printable ASCII.
  const cleaned = text.replace(/\u0000+/g, '').trim()
  return cleaned
}

function extractAsciiTokenFromBytes(buf: Buffer): string | null {
  // For RSA_NO_PADDING, plaintext is often left-padded with zeros and may contain garbage.
  // Try to recover a meaningful token by extracting the longest run of printable ASCII.
  const ascii = buf.toString('latin1')
  // Prefer digit runs (transaction ids are often numeric after decrypt).
  const digitMatches = ascii.match(/[0-9]{6,}/g)
  if (digitMatches && digitMatches.length > 0) {
    const best = digitMatches.sort((a, b) => b.length - a.length)[0]
    return best || null
  }

  // Otherwise, extract a run of safe URL-ish chars.
  const tokenMatches = ascii.match(/[A-Za-z0-9._-]{8,}/g)
  if (tokenMatches && tokenMatches.length > 0) {
    const best = tokenMatches.sort((a, b) => b.length - a.length)[0]
    return best || null
  }

  return null
}

function looksLikeDecryptedTransactionId(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.length > 128) return false
  // Typically digits, but be tolerant.
  if (/\s/.test(t)) return false
  // Only printable-ish
  return /^[\x20-\x7E]+$/.test(t)
}

export function decryptMonCashButtonReturnTransactionId(encryptedTransactionId: string): string | null {
  // Digicel docs:
  // transactionId = decrypt(base64_decode(GET(transactionId)))
  // We attempt best-effort RSA private decryption when a private key is available.
  const cipherBytes = decodeBase64OrBase64UrlToBuffer(encryptedTransactionId)
  if (!cipherBytes || cipherBytes.length === 0) return null

  const keyCandidates: Array<{ name: 'primary' | 'form'; keyPem: string | null }> = [
    { name: 'primary', keyPem: getMonCashButtonPrivateKeyPemMaybe() },
    { name: 'form', keyPem: getMonCashFormPrivateKeyPemMaybe() },
  ]

  const paddingModes: RsaPaddingMode[] = ['none', 'pkcs1', 'oaep-sha1', 'oaep-sha256']

  for (const key of keyCandidates) {
    if (!key.keyPem) continue
    for (const paddingMode of paddingModes) {
      const decryptOptions: crypto.RsaPrivateKey = {
        key: key.keyPem,
        padding:
          paddingMode === 'none'
            ? (crypto.constants as any).RSA_NO_PADDING
            : paddingMode === 'pkcs1'
              ? crypto.constants.RSA_PKCS1_PADDING
              : crypto.constants.RSA_PKCS1_OAEP_PADDING,
      }
      if (paddingMode === 'oaep-sha256') {
        ;(decryptOptions as any).oaepHash = 'sha256'
      }

      try {
        const plain = crypto.privateDecrypt(decryptOptions as any, cipherBytes)
        const asUtf8 = stripNonPrintableAndNulls(plain.toString('utf8'))
        if (looksLikeDecryptedTransactionId(asUtf8)) return asUtf8

        const asLatin1 = stripNonPrintableAndNulls(plain.toString('latin1'))
        if (looksLikeDecryptedTransactionId(asLatin1)) return asLatin1

        const extracted = extractAsciiTokenFromBytes(plain)
        if (extracted && looksLikeDecryptedTransactionId(extracted)) return extracted
      } catch {
        // Try other padding/key candidates.
        continue
      }
    }
  }

  return null
}

export function getMonCashButtonReturnDecryptConfig(): {
  hasPrimaryPrivateKey: boolean
  hasFormPrivateKey: boolean
} {
  return {
    hasPrimaryPrivateKey: Boolean(getMonCashButtonPrivateKeyPemMaybe()),
    hasFormPrivateKey: Boolean(getMonCashFormPrivateKeyPemMaybe()),
  }
}

type RsaPaddingMode = 'none' | 'pkcs1' | 'oaep-sha1' | 'oaep-sha256'

type CiphertextEncoding = 'base64' | 'base64url'

function getCiphertextEncodingsToTry(): CiphertextEncoding[] {
  const configured = (process.env.MONCASH_BUTTON_CIPHERTEXT_ENCODING || '').toLowerCase()
  if (configured === 'base64url') return ['base64url']
  if (configured === 'base64') return ['base64']
  // Default: try standard base64 first, then URL-safe base64.
  return ['base64', 'base64url']
}

function encodeCiphertext(buf: Buffer, encoding: CiphertextEncoding): string {
  if (encoding === 'base64') return buf.toString('base64')
  // base64url without padding
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function getFormCiphertextEncoding(): CiphertextEncoding {
  const configured = (process.env.MONCASH_BUTTON_FORM_CIPHERTEXT_ENCODING || '').toLowerCase()
  if (configured === 'base64') return 'base64'
  // Default to base64url to avoid '+' and '/' handling bugs in some form decoders.
  return 'base64url'
}

function sha256Short(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function getRsaPaddingMode(): RsaPaddingMode {
  const mode = (process.env.MONCASH_BUTTON_RSA_PADDING || 'pkcs1').toLowerCase()
  if (mode === 'auto') return 'none'
  if (mode === 'none' || mode === 'no-padding' || mode === 'nopadding') return 'none'
  if (mode === 'oaep' || mode === 'oaep-sha1') return 'oaep-sha1'
  if (mode === 'oaep-sha256') return 'oaep-sha256'
  return 'pkcs1'
}

function parseRsaPaddingMode(modeRaw: string | undefined, defaultMode: RsaPaddingMode): RsaPaddingMode {
  const mode = (modeRaw || '').toLowerCase().trim()
  if (!mode) return defaultMode
  if (mode === 'auto') return defaultMode
  if (mode === 'none' || mode === 'no-padding' || mode === 'nopadding') return 'none'
  if (mode === 'pkcs1') return 'pkcs1'
  if (mode === 'oaep' || mode === 'oaep-sha1') return 'oaep-sha1'
  if (mode === 'oaep-sha256') return 'oaep-sha256'
  return defaultMode
}

function getFormRsaPaddingMode(): RsaPaddingMode {
  // Digicel MonCash Button docs/examples typically use RSA/None/NoPadding.
  // Keep REST token padding controlled by MONCASH_BUTTON_RSA_PADDING.
  return parseRsaPaddingMode(process.env.MONCASH_BUTTON_FORM_RSA_PADDING, 'none')
}

function getRsaPaddingModesToTry(): RsaPaddingMode[] {
  const configured = getRsaPaddingMode()
  const envMode = (process.env.MONCASH_BUTTON_RSA_PADDING || '').toLowerCase()
  if (isRsaPaddingExplicit() && envMode !== 'auto') return [configured]

  const all: RsaPaddingMode[] = ['none', 'pkcs1', 'oaep-sha1', 'oaep-sha256']
  return [configured, ...all.filter((m) => m !== configured)]
}

function getKeyDetails() {
  const keyPem = getMonCashButtonKeyPem()
  const keyObject = crypto.createPublicKey(keyPem)
  const modulusLength = (keyObject.asymmetricKeyDetails as any)?.modulusLength as number | undefined
  return { keyPem, modulusLength }
}

function maxPlaintextBytes(modulusLengthBits: number | undefined, paddingMode: RsaPaddingMode): number | undefined {
  if (!modulusLengthBits) return undefined
  const k = Math.ceil(modulusLengthBits / 8)
  if (paddingMode === 'none') return k
  if (paddingMode === 'pkcs1') return k - 11
  const hLen = paddingMode === 'oaep-sha256' ? 32 : 20
  return k - 2 * hLen - 2
}

function getKeySizeBytes(modulusLengthBits: number | undefined): number | undefined {
  if (!modulusLengthBits) return undefined
  return Math.ceil(modulusLengthBits / 8)
}

function leftPadToLength(buf: Buffer, length: number): Buffer {
  if (buf.length === length) return buf
  if (buf.length > length) return buf
  const out = Buffer.alloc(length)
  buf.copy(out, length - buf.length)
  return out
}

function publicEncryptBytes(value: string, paddingOverride?: RsaPaddingMode): Buffer {
  const { keyPem, modulusLength } = getKeyDetails()
  let buffer: Buffer<ArrayBufferLike> = Buffer.from(value, 'utf8')
  const paddingMode = paddingOverride ?? getRsaPaddingMode()

  const maxLen = maxPlaintextBytes(modulusLength, paddingMode)
  if (maxLen != null && buffer.length > maxLen) {
    throw new Error(
      `MonCash Button RSA plaintext too long (len=${buffer.length}, max=${maxLen}) for padding=${paddingMode} (modulusLength=${modulusLength ?? 'unknown'}). Use a shorter orderId.`
    )
  }

  // NOTE: Some Digicel environments appear to use very small keys; don't block OAEP by key size.
  // Plaintext size constraints are enforced via maxPlaintextBytes().

  // MonCash Button documentation examples use RSA/None/NoPadding.
  // For RSA_NO_PADDING, OpenSSL expects an input block of the full key size.
  if (paddingMode === 'none') {
    const keySizeBytes = getKeySizeBytes(modulusLength)
    if (!keySizeBytes) {
      throw new Error('MonCash Button RSA key size is unknown; cannot use padding=none')
    }
    buffer = leftPadToLength(buffer, keySizeBytes)
  }

  const encryptOptions: crypto.RsaPublicKey = {
    key: keyPem,
    padding:
      paddingMode === 'none'
        ? (crypto.constants as any).RSA_NO_PADDING
        : paddingMode === 'pkcs1'
          ? crypto.constants.RSA_PKCS1_PADDING
          : crypto.constants.RSA_PKCS1_OAEP_PADDING,
  }

  if (paddingMode === 'oaep-sha256') {
    ;(encryptOptions as any).oaepHash = 'sha256'
  }

  try {
    return crypto.publicEncrypt(encryptOptions as any, buffer)
  } catch (err: any) {
    if (err?.code === 'ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE') {
      const hint =
        maxLen != null
          ? `Max plaintext length is ~${maxLen} bytes for this key/padding.`
          : 'Plaintext is larger than allowed for this key/padding.'

      throw new Error(
        `MonCash Button RSA encryption failed: data too large for key size (padding=${paddingMode}, modulusLength=${modulusLength ?? 'unknown'}). ${hint} Use a shorter orderId and ensure MONCASH_BUTTON_RSA_PADDING=pkcs1.`
      )
    }
    throw err
  }
}

function formatAmountForGateway(amount: number): string {
  // Many MonCash integrations expect a whole-number HTG amount.
  if (Number.isFinite(amount) && Math.abs(amount - Math.round(amount)) < 1e-9) {
    return String(Math.round(amount))
  }
  return amount.toFixed(2)
}

function getBusinessKey(): string {
  const businessKey = (process.env.MONCASH_BUTTON_BUSINESS_KEY || '').trim()
  if (!businessKey) {
    throw new Error('MONCASH_BUTTON_BUSINESS_KEY is not configured')
  }
  return businessKey
}

function getMonCashFormBusinessKey(): string {
  const businessKey = (process.env.MONCASH_BUTTON_FORM_BUSINESS_KEY || process.env.MONCASH_BUTTON_BUSINESS_KEY || '').trim()
  if (!businessKey) {
    throw new Error('MONCASH_BUTTON_BUSINESS_KEY is not configured')
  }
  return businessKey
}

function isLikelyBase64(value: string): boolean {
  const cleaned = value.trim().replace(/\s+/g, '')
  if (cleaned.length < 8) return false
  if (cleaned.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/=]+$/.test(cleaned)
}

function base64DecodeUtf8(value: string): string | null {
  try {
    const decoded = Buffer.from(value.trim(), 'base64').toString('utf8').trim()
    if (!decoded) return null
    // Keep it conservative; BusinessKey is typically short ASCII.
    if (!/^[\x20-\x7E]+$/.test(decoded)) return null
    if (decoded.length > 256) return null
    return decoded
  } catch {
    return null
  }
}

function expandWhitespaceVariants(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  if (!/\s/.test(trimmed)) return [trimmed]

  const tokens = trimmed.split(/\s+/g).map((t) => t.trim()).filter(Boolean)
  const noWhitespace = trimmed.replace(/\s+/g, '')
  const joined = tokens.join('')

  // IMPORTANT: never include the original whitespace-containing value, because it will produce "%20" in the URL path.
  return Array.from(new Set([noWhitespace, ...tokens, joined].filter(Boolean)))
}

function stripBase64Padding(value: string): string {
  return value.replace(/=+$/g, '')
}

function toBase64Url(value: string): string {
  // Convert base64 to base64url (leave non-base64 chars as-is; caller decides applicability).
  return value.replace(/\+/g, '-').replace(/\//g, '_')
}

function expandPathSafeVariants(candidate: string): Array<{ segment: string; kind: string }> {
  const trimmed = candidate.trim()
  if (!trimmed) return []

  const out: Array<{ segment: string; kind: string }> = [{ segment: trimmed, kind: 'raw' }]

  // Many gateways treat '=' oddly in path segments; try unpadded versions.
  const unpadded = stripBase64Padding(trimmed)
  if (unpadded && unpadded !== trimmed) out.push({ segment: unpadded, kind: 'raw-unpadded' })

  // If it resembles base64/base64url, also try url-safe conversion.
  // NOTE: This does not validate that the value is base64; it just produces an additional common routing-safe variant.
  const urlSafe = toBase64Url(trimmed)
  const urlSafeUnpadded = stripBase64Padding(urlSafe)
  if (urlSafe !== trimmed) out.push({ segment: urlSafe, kind: 'base64url' })
  if (urlSafeUnpadded && urlSafeUnpadded !== urlSafe && urlSafeUnpadded !== trimmed) {
    out.push({ segment: urlSafeUnpadded, kind: 'base64url-unpadded' })
  }

  // Percent-encoded fallback (some routers only match when encoded).
  const encoded = encodeURIComponent(trimmed)
  if (encoded !== trimmed) out.push({ segment: encoded, kind: 'encoded' })

  // Keep unique segments, preserving first-seen kind.
  const seen = new Set<string>()
  return out.filter((x) => {
    if (!x.segment) return false
    if (/\s/.test(x.segment)) return false
    if (seen.has(x.segment)) return false
    seen.add(x.segment)
    return true
  })
}

function getBusinessKeyCandidatesFrom(rawValue: string): string[] {
  const raw = rawValue.trim()
  const candidates: string[] = []

  // If the env var was pasted with spaces/newlines, try additional variants.
  if (/\s/.test(raw)) {
    const tokens = raw.split(/\s+/g).map((t) => t.trim()).filter(Boolean)
    // Prefer whitespace-safe variants first so we avoid routing with "%20" in the path.
    const noWhitespace = raw.replace(/\s+/g, '')
    if (noWhitespace && noWhitespace !== raw) candidates.push(noWhitespace)
    for (const token of tokens) candidates.push(token)

    // Sometimes portals show a key in two wrapped lines; concatenation is the intended value.
    if (tokens.length > 1) {
      const joined = tokens.join('')
      if (joined && joined !== noWhitespace) candidates.push(joined)
    }
  }

  // Always include the raw value as a fallback.
  candidates.push(raw)

  // If any candidate looks like base64, also try decoding it (some portals provide an encoded BusinessKey).
  // If the decoded value contains whitespace, try its tokens first (to avoid "%20" in the path).
  for (const candidate of [...candidates]) {
    if (!isLikelyBase64(candidate)) continue
    const decoded = base64DecodeUtf8(candidate)
    if (!decoded) continue

    const decodedVariants = expandWhitespaceVariants(decoded)
    for (const v of decodedVariants) candidates.push(v)
  }

  // Dedupe + drop empties
  return Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)))
}

function getBusinessKeyCandidates(): string[] {
  return getBusinessKeyCandidatesFrom(getBusinessKey())
}

function getFormBusinessKeyCandidates(): string[] {
  return getBusinessKeyCandidatesFrom(getMonCashFormBusinessKey())
}

function getBusinessKeyPathSegments(): string[] {
  // Some vendor gateways do not route correctly if the path is percent-encoded.
  // We'll try raw first, then encoded as a fallback.
  const segments: string[] = []
  for (const candidate of getBusinessKeyCandidates()) {
    for (const v of expandPathSafeVariants(candidate)) {
      segments.push(v.segment)
    }
  }
  return Array.from(new Set(segments))
}

function getBusinessKeyPathSegmentMeta(): Array<{ segment: string; kind: string }> {
  const out: Array<{ segment: string; kind: string }> = []
  for (const candidate of getBusinessKeyCandidates()) {
    out.push(...expandPathSafeVariants(candidate))
  }
  // Dedupe while preserving first kind.
  const seen = new Set<string>()
  return out.filter((x) => {
    if (seen.has(x.segment)) return false
    seen.add(x.segment)
    return true
  })
}

function getFormBusinessKeyPathSegmentMeta(): Array<{ segment: string; kind: string }> {
  const out: Array<{ segment: string; kind: string }> = []
  for (const candidate of getFormBusinessKeyCandidates()) {
    out.push(...expandPathSafeVariants(candidate))
  }
  const seen = new Set<string>()
  return out.filter((x) => {
    if (seen.has(x.segment)) return false
    seen.add(x.segment)
    return true
  })
}

function pickPrimaryBusinessKeySegment(): string {
  const segments = getBusinessKeyPathSegmentMeta()
  if (segments.length === 0) {
    throw new Error('MONCASH_BUTTON_BUSINESS_KEY is not configured')
  }
  // Prefer the first raw-ish segment (raw/raw-unpadded), otherwise fall back to the first.
  const preferred = segments.find((s) => s.kind.startsWith('raw'))
  return (preferred || segments[0]).segment
}

function pickPrimaryFormBusinessKeySegment(): string {
  const segments = getFormBusinessKeyPathSegmentMeta()
  if (segments.length === 0) {
    throw new Error('MONCASH_BUTTON_BUSINESS_KEY is not configured')
  }
  const preferred = segments.find((s) => s.kind.startsWith('raw'))
  return (preferred || segments[0]).segment
}

function publicEncryptBytesWithKey(value: string, keyPem: string, paddingMode: RsaPaddingMode): Buffer {
  const keyObject = crypto.createPublicKey(keyPem)
  const modulusLength = (keyObject.asymmetricKeyDetails as any)?.modulusLength as number | undefined

  let buffer: Buffer<ArrayBufferLike> = Buffer.from(value, 'utf8')

  const maxLen = maxPlaintextBytes(modulusLength, paddingMode)
  if (maxLen != null && buffer.length > maxLen) {
    throw new Error(
      `MonCash Button RSA plaintext too long (len=${buffer.length}, max=${maxLen}) for padding=${paddingMode} (modulusLength=${modulusLength ?? 'unknown'}). Use a shorter orderId.`
    )
  }

  if (paddingMode === 'none') {
    const keySizeBytes = getKeySizeBytes(modulusLength)
    if (!keySizeBytes) {
      throw new Error('MonCash Button RSA key size is unknown; cannot use padding=none')
    }
    buffer = leftPadToLength(buffer, keySizeBytes)
  }

  const encryptOptions: crypto.RsaPublicKey = {
    key: keyPem,
    padding:
      paddingMode === 'none'
        ? (crypto.constants as any).RSA_NO_PADDING
        : paddingMode === 'pkcs1'
          ? crypto.constants.RSA_PKCS1_PADDING
          : crypto.constants.RSA_PKCS1_OAEP_PADDING,
  }

  if (paddingMode === 'oaep-sha256') {
    ;(encryptOptions as any).oaepHash = 'sha256'
  }

  return crypto.publicEncrypt(encryptOptions as any, buffer)
}

export function createMonCashButtonCheckoutFormPost(params: {
  amount: number
  orderId: string
}): {
  actionUrl: string
  fields: { amount: string; orderId: string }
  meta: {
    mode: 'sandbox' | 'production'
    paddingMode: RsaPaddingMode
    amountPlaintext: string
    businessKeySegmentHash: string
    businessKeySegmentKind: string
    ciphertextEncoding: CiphertextEncoding
  }
} {
  const mode = getMonCashFormMode()
  const baseUrl = getMonCashMiddlewareBaseUrlForMode(mode)
  const businessKey = pickPrimaryFormBusinessKeySegment()

  const businessKeyMeta = getFormBusinessKeyPathSegmentMeta().find((s) => s.segment === businessKey)
  const businessKeySegmentKind = businessKeyMeta?.kind || 'unknown'
  const businessKeySegmentHash = sha256Short(businessKey)

  const amountStr = formatAmountForGateway(params.amount)
  const paddingMode = getFormRsaPaddingMode()

  const ciphertextEncoding = getFormCiphertextEncoding()
  const keyPem = getMonCashFormKeyPem()

  const encryptedAmount = encodeCiphertext(publicEncryptBytesWithKey(amountStr, keyPem, paddingMode), ciphertextEncoding)
  const encryptedOrderId = encodeCiphertext(
    publicEncryptBytesWithKey(params.orderId, keyPem, paddingMode),
    ciphertextEncoding
  )

  return {
    actionUrl: `${baseUrl}/Checkout/${businessKey}`,
    fields: {
      amount: encryptedAmount,
      orderId: encryptedOrderId,
    },
    meta: {
      mode,
      paddingMode,
      amountPlaintext: amountStr,
      businessKeySegmentHash,
      businessKeySegmentKind,
      ciphertextEncoding,
    },
  }
}

export function encryptToMonCashButtonBase64(value: string): string {
  return encodeCiphertext(publicEncryptBytes(value), 'base64')
}

function encryptToMonCashButtonCiphertext(value: string, paddingMode: RsaPaddingMode, encoding: CiphertextEncoding): string {
  return encodeCiphertext(publicEncryptBytes(value, paddingMode), encoding)
}

function encryptToMonCashButtonCiphertextWithKeyPem(
  value: string,
  keyPem: string,
  paddingMode: RsaPaddingMode,
  encoding: CiphertextEncoding
): string {
  return encodeCiphertext(publicEncryptBytesWithKey(value, keyPem, paddingMode), encoding)
}

type MonCashButtonTokenResponse = {
  success: boolean
  token?: string
  message?: string
}

export async function createMonCashButtonCheckoutToken(params: {
  amount: number
  orderId: string
}): Promise<{ token: string }> {
  const configuredMode = getMonCashMode()
  const baseUrl = getMonCashMiddlewareBaseUrl()

  const amountStr = formatAmountForGateway(params.amount)
  const businessKeySegments = getBusinessKeyPathSegmentMeta()
  const paddingModes = getRsaPaddingModesToTry()
  const ciphertextEncodings = getCiphertextEncodingsToTry()

  async function postForMode(
    mode: 'sandbox' | 'production',
    businessKeySegment: string,
    paddingMode: RsaPaddingMode,
    ciphertextEncoding: CiphertextEncoding
  ): Promise<Response> {
    const modeBaseUrl = mode === configuredMode ? baseUrl : getMonCashMiddlewareBaseUrlForMode(mode)
    const encryptedAmount = encryptToMonCashButtonCiphertext(amountStr, paddingMode, ciphertextEncoding)
    const encryptedOrderId = encryptToMonCashButtonCiphertext(params.orderId, paddingMode, ciphertextEncoding)

    const body = new URLSearchParams({
      amount: encryptedAmount,
      orderId: encryptedOrderId,
    }).toString()

    return fetch(`${modeBaseUrl}/Checkout/Rest/${businessKeySegment}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
  }

  async function parseResponse(resp: Response): Promise<{ data?: MonCashButtonTokenResponse; rawText?: string }> {
    const rawText = await resp.text().catch(() => '')
    // Attempt JSON parse regardless of content-type; Digicel sometimes returns JSON without the header.
    const data = (() => {
      try {
        return JSON.parse(rawText) as MonCashButtonTokenResponse
      } catch {
        return undefined
      }
    })()
    return { data, rawText }
  }

  const retryableHttpStatuses = new Set([404, 410])
  const retryableGatewayError = (rawText?: string) => {
    if (!rawText) return false
    return /system\s*error/i.test(rawText) || /could\s*not\s*pars/i.test(rawText)
  }

  async function tryTokenRequestsForMode(mode: 'sandbox' | 'production') {
    let lastAttempt:
      | {
          response: Response
          parsed: { data?: MonCashButtonTokenResponse; rawText?: string }
          meta: {
            segmentHash: string
            segmentKind: string
            paddingMode: RsaPaddingMode
            ciphertextEncoding: CiphertextEncoding
          }
        }
      | null = null
    let attempts = 0
    for (const ciphertextEncoding of ciphertextEncodings) {
      for (const paddingMode of paddingModes) {
        for (const segmentInfo of businessKeySegments) {
          try {
          attempts += 1
          const response = await postForMode(mode, segmentInfo.segment, paddingMode, ciphertextEncoding)
          const parsed = await parseResponse(response)

          lastAttempt = {
            response,
            parsed,
            meta: {
              segmentHash: sha256Short(segmentInfo.segment),
              segmentKind: segmentInfo.kind,
              paddingMode,
              ciphertextEncoding,
            },
          }

          if (response.ok && parsed.data?.success && parsed.data.token) {
            return { response, parsed, attempts }
          }

          const rawText = parsed.rawText || ''
          const shouldRetry =
            !response.ok
              ? (response.status === 500 ? true : retryableHttpStatuses.has(response.status))
              : !parsed.data?.success && retryableGatewayError(rawText)

          if (!shouldRetry) {
            return { response, parsed, attempts }
          }
          } catch (err: any) {
            // Allow trying other variants when a padding/key combination can't encrypt.
            const message = String(err?.message || err)
            if (/rsa/i.test(message)) continue
            throw err
          }
        }
      }
    }
    return lastAttempt ? { ...lastAttempt, attempts } : null
  }

  const attemptConfigured = await tryTokenRequestsForMode(configuredMode)
  let attemptFallback: any = null
  let fallbackMode: 'sandbox' | 'production' = configuredMode === 'sandbox' ? 'production' : 'sandbox'

  // If the portal keys belong to the other environment, Digicel often returns 404/410 or generic parse errors.
  // Auto-fallback when MONCASH_BUTTON_MODE is NOT explicitly set.
  if (!isButtonModeExplicit()) {
    const configuredOk =
      !!attemptConfigured?.response?.ok &&
      !!attemptConfigured?.parsed?.data?.success &&
      typeof attemptConfigured?.parsed?.data?.token === 'string'

    if (!configuredOk) {
      console.warn('[MonCash Button] Token request failed on', configuredMode, '- trying', fallbackMode)
      attemptFallback = await tryTokenRequestsForMode(fallbackMode)
    }
  }

  const configuredOk =
    !!attemptConfigured?.response?.ok &&
    !!attemptConfigured?.parsed?.data?.success &&
    typeof attemptConfigured?.parsed?.data?.token === 'string'
  const fallbackOk =
    !!attemptFallback?.response?.ok &&
    !!attemptFallback?.parsed?.data?.success &&
    typeof attemptFallback?.parsed?.data?.token === 'string'

  // Choose the best attempt: prefer any success, otherwise prefer the fallback attempt if it exists (so diagnostics show both).
  const bestAttempt = (fallbackOk ? attemptFallback : configuredOk ? attemptConfigured : attemptFallback ?? attemptConfigured) as any
  const bestAttemptMode: 'sandbox' | 'production' = bestAttempt === attemptFallback ? fallbackMode : configuredMode

  if (!bestAttempt) throw new Error('MonCash Button token request failed: unable to perform any attempts')

  const { response, parsed } = bestAttempt
  const data = parsed.data
  if (!response.ok || !data?.success || !data.token) {
    const message =
      data?.message ||
      (parsed.rawText ? parsed.rawText.slice(0, 500) : '') ||
      `MonCash Button token request failed (${response.status})`

    // Avoid logging secrets; only include mode + status.
    console.error('[MonCash Button] Token request error:', {
      status: response.status,
      mode: configuredMode,
      attemptedMode: bestAttemptMode,
      helperVersion: MONCASH_BUTTON_HELPER_VERSION,
      modeExplicit: isButtonModeExplicit(),
      rsaPaddingExplicit: isRsaPaddingExplicit(),
      businessKeySegments: businessKeySegments.length,
      paddingModes: paddingModes.length,
      ciphertextEncodings: ciphertextEncodings.length,
      attempts: (bestAttempt as any)?.attempts,
      lastAttempt: (bestAttempt as any)?.meta,
      fallbackAttempt:
        !isButtonModeExplicit() && attemptFallback
          ? {
              attemptedMode: fallbackMode,
              status: (attemptFallback as any)?.response?.status,
              attempts: (attemptFallback as any)?.attempts,
              lastAttempt: (attemptFallback as any)?.meta,
            }
          : undefined,
    })
    throw new Error(`MonCash Button token request failed (${response.status}): ${message}`)
  }

  return { token: data.token }
}

export function getMonCashButtonRedirectUrl(token: string): string {
  const baseUrl = getMonCashMiddlewareBaseUrl()
  return `${baseUrl}/Checkout/Payment/Redirect/${token}`
}

type MonCashButtonPaymentResponse = {
  success: boolean
  reference?: string
  payment_status?: boolean
  transNumber?: string
  payer?: string
  cost?: string | number
  message?: string
}

export async function getMonCashButtonPaymentByTransactionId(
  transactionId: string
): Promise<MonCashButtonPaymentResponse> {
  const paddingModes = getRsaPaddingModesToTry()
  const ciphertextEncodings = getCiphertextEncodingsToTry()

  const lookupConfigs: Array<{
    name: 'primary' | 'form'
    configuredMode: 'sandbox' | 'production'
    businessKeySegments: Array<{ segment: string; kind: string }>
    getKeyPem: () => string
  }> = [
    {
      name: 'primary',
      configuredMode: getMonCashMode(),
      businessKeySegments: getBusinessKeyPathSegmentMeta(),
      getKeyPem: getMonCashButtonKeyPem,
    },
  ]

  // Form fallback: checkout can succeed via createMonCashButtonCheckoutFormPost(),
  // but lookups will fail unless we also try FORM credentials.
  try {
    getMonCashFormBusinessKey()
    getMonCashFormKeyPem()
    lookupConfigs.push({
      name: 'form',
      configuredMode: getMonCashFormMode(),
      businessKeySegments: getFormBusinessKeyPathSegmentMeta(),
      getKeyPem: getMonCashFormKeyPem,
    })
  } catch {
    // ignore
  }

  const retryableHttpStatuses = new Set([404, 410])
  const retryableGatewayError = (rawText?: string) => {
    if (!rawText) return false
    return /system\s*error/i.test(rawText) || /could\s*not\s*pars/i.test(rawText)
  }

  const looksLikeCiphertextFromReturnUrl = (() => {
    const raw = String(transactionId || '').trim()
    if (!raw) return false
    // Most observed ReturnUrl values are base64/base64url-ish and ~44 chars.
    if (raw.length >= 40 && raw.length <= 200 && /^[A-Za-z0-9+/_=-]+$/.test(raw)) return true
    return false
  })()

  async function postLookupRawCiphertextForMode(
    mode: 'sandbox' | 'production',
    businessKeySegment: string,
    transactionIdCiphertext: string
  ): Promise<Response> {
    const modeBaseUrl = getMonCashMiddlewareBaseUrlForMode(mode)
    return fetch(`${modeBaseUrl}/Checkout/${businessKeySegment}/Payment/Transaction/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        transactionId: transactionIdCiphertext,
      }).toString(),
    })
  }

  async function tryLookupUsingRawCiphertext(mode: 'sandbox' | 'production', keySegments: Array<{ segment: string; kind: string }>) {
    const candidates = Array.from(
      new Set([
        String(transactionId || '').trim(),
        ...buildTokenVariants(String(transactionId || '').trim()),
      ].filter(Boolean))
    )

    for (const candidate of candidates) {
      for (const segmentInfo of keySegments) {
        const response = await postLookupRawCiphertextForMode(mode, segmentInfo.segment, candidate)
        const parsed = await parsePaymentResponse(response)
        if (response.ok && parsed.data?.success) return parsed.data

        const rawText = parsed.rawText || ''
        const shouldRetry =
          !response.ok
            ? (response.status === 500 ? true : retryableHttpStatuses.has(response.status))
            : !parsed.data?.success && retryableGatewayError(rawText)

        if (!shouldRetry) {
          // Return the first definitive failure to keep behavior consistent.
          if (parsed.data) return parsed.data
        }
      }
    }
    return null
  }

  async function postLookupForMode(
    keyPem: string,
    mode: 'sandbox' | 'production',
    businessKeySegment: string,
    transactionIdPlaintext: string,
    paddingMode: RsaPaddingMode,
    ciphertextEncoding: CiphertextEncoding
  ): Promise<Response> {
    const modeBaseUrl = getMonCashMiddlewareBaseUrlForMode(mode)
    const encryptedTransactionId = encryptToMonCashButtonCiphertextWithKeyPem(
      transactionIdPlaintext,
      keyPem,
      paddingMode,
      ciphertextEncoding
    )
    return fetch(`${modeBaseUrl}/Checkout/${businessKeySegment}/Payment/Transaction/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        transactionId: encryptedTransactionId,
      }).toString(),
    })
  }

  async function parsePaymentResponse(resp: Response): Promise<{ data?: MonCashButtonPaymentResponse; rawText?: string }> {
    const rawText = await resp.text().catch(() => '')
    const data = (() => {
      try {
        return JSON.parse(rawText) as MonCashButtonPaymentResponse
      } catch {
        return undefined
      }
    })()
    return { data, rawText }
  }

  async function tryLookupForMode(
    keyPem: string,
    transactionIdPlaintext: string,
    businessKeySegments: Array<{ segment: string; kind: string }>,
    mode: 'sandbox' | 'production'
  ) {
    let lastAttempt:
      | {
          response: Response
          parsed: { data?: MonCashButtonPaymentResponse; rawText?: string }
          meta: {
            segmentHash: string
            segmentKind: string
            paddingMode: RsaPaddingMode
            ciphertextEncoding: CiphertextEncoding
          }
        }
      | null = null
    let attempts = 0
    for (const ciphertextEncoding of ciphertextEncodings) {
      for (const paddingMode of paddingModes) {
        for (const segmentInfo of businessKeySegments) {
          try {
            attempts += 1
            const response = await postLookupForMode(
              keyPem,
              mode,
              segmentInfo.segment,
              transactionIdPlaintext,
              paddingMode,
              ciphertextEncoding
            )
            const parsed = await parsePaymentResponse(response)

            lastAttempt = {
              response,
              parsed,
              meta: {
                segmentHash: sha256Short(segmentInfo.segment),
                segmentKind: segmentInfo.kind,
                paddingMode,
                ciphertextEncoding,
              },
            }

            if (response.ok && parsed.data?.success) {
              return { response, parsed, attempts }
            }

            const rawText = parsed.rawText || ''
            const shouldRetry =
              !response.ok
                ? (response.status === 500 ? true : retryableHttpStatuses.has(response.status))
                : !parsed.data?.success && retryableGatewayError(rawText)

            if (!shouldRetry) {
              return { response, parsed, attempts }
            }
          } catch (err: any) {
            const message = String(err?.message || err)
            if (/rsa/i.test(message)) continue
            throw err
          }
        }
      }
    }
    return lastAttempt ? { ...lastAttempt, attempts } : null
  }

  let lastError: any = null

  for (const config of lookupConfigs) {
    let keyPem: string
    try {
      keyPem = config.getKeyPem()
    } catch (err) {
      lastError = err
      continue
    }

    const configuredMode = config.configuredMode
    const fallbackMode: 'sandbox' | 'production' = configuredMode === 'sandbox' ? 'production' : 'sandbox'

    // If the ReturnUrl transactionId is already an encrypted/base64 value, some middleware deployments
    // accept it directly (without us re-encrypting). Try that first.
    if (looksLikeCiphertextFromReturnUrl) {
      try {
        const direct = await tryLookupUsingRawCiphertext(configuredMode, config.businessKeySegments)
        if (direct && direct.success) return direct
      } catch (err) {
        lastError = err
      }

      if (!(isButtonModeExplicit() && config.name === 'primary')) {
        try {
          const directFallback = await tryLookupUsingRawCiphertext(fallbackMode, config.businessKeySegments)
          if (directFallback && directFallback.success) return directFallback
        } catch (err) {
          lastError = err
        }
      }
    }

    // If we can decode the ReturnUrl value into a plausible plaintext transaction id without keys,
    // prefer that for encryption attempts.
    const decodedPlaintext = looksLikeCiphertextFromReturnUrl ? maybeDecodeReturnTransactionIdWithoutKey(transactionId) : null
    const effectiveTransactionId = decodedPlaintext || transactionId

    let bestAttempt: any = await tryLookupForMode(keyPem, effectiveTransactionId, config.businessKeySegments, configuredMode)
    let bestAttemptMode: 'sandbox' | 'production' = configuredMode

    // Preserve the previous behavior: if MONCASH_BUTTON_MODE is explicitly set, don't probe the other mode.
    const allowModeFallback = !(isButtonModeExplicit() && config.name === 'primary')
    if (allowModeFallback) {
      const configuredOk = !!bestAttempt?.response?.ok && !!bestAttempt?.parsed?.data?.success
      if (!configuredOk) {
        const attemptFallback = await tryLookupForMode(keyPem, effectiveTransactionId, config.businessKeySegments, fallbackMode)
        const fallbackOk = !!attemptFallback?.response?.ok && !!attemptFallback?.parsed?.data?.success
        if (fallbackOk) {
          bestAttempt = attemptFallback
          bestAttemptMode = fallbackMode
        } else if (!bestAttempt && attemptFallback) {
          bestAttempt = attemptFallback
          bestAttemptMode = fallbackMode
        }
      }
    }

    if (!bestAttempt) {
      lastError = new Error('MonCash Button transaction lookup failed: unable to perform any attempts')
      continue
    }

    const { response, parsed } = bestAttempt
    const data = parsed.data
    if (!data) {
      lastError = new Error(
        `MonCash Button transaction lookup failed (${response.status}): ${parsed.rawText || 'Invalid JSON response'}`
      )
      continue
    }

    if (!response.ok) {
      console.error('[MonCash Button] Transaction lookup error:', {
        status: response.status,
        mode: configuredMode,
        attemptedMode: bestAttemptMode,
        config: config.name,
        helperVersion: MONCASH_BUTTON_HELPER_VERSION,
        modeExplicit: isButtonModeExplicit(),
        rsaPaddingExplicit: isRsaPaddingExplicit(),
        businessKeySegments: config.businessKeySegments.length,
        paddingModes: paddingModes.length,
        ciphertextEncodings: ciphertextEncodings.length,
        attempts: (bestAttempt as any)?.attempts,
        lastAttempt: (bestAttempt as any)?.meta,
      })
      lastError = new Error(data?.message || `MonCash Button transaction lookup failed (${response.status})`)
      continue
    }

    return data
  }

  throw lastError || new Error('MonCash Button transaction lookup failed')
}

export async function getMonCashButtonPaymentByOrderId(orderId: string): Promise<MonCashButtonPaymentResponse> {
  const paddingModes = getRsaPaddingModesToTry()
  const ciphertextEncodings = getCiphertextEncodingsToTry()

  const lookupConfigs: Array<{
    name: 'primary' | 'form'
    configuredMode: 'sandbox' | 'production'
    businessKeySegments: Array<{ segment: string; kind: string }>
    getKeyPem: () => string
  }> = [
    {
      name: 'primary',
      configuredMode: getMonCashMode(),
      businessKeySegments: getBusinessKeyPathSegmentMeta(),
      getKeyPem: getMonCashButtonKeyPem,
    },
  ]

  try {
    getMonCashFormBusinessKey()
    getMonCashFormKeyPem()
    lookupConfigs.push({
      name: 'form',
      configuredMode: getMonCashFormMode(),
      businessKeySegments: getFormBusinessKeyPathSegmentMeta(),
      getKeyPem: getMonCashFormKeyPem,
    })
  } catch {
    // ignore
  }

  const retryableHttpStatuses = new Set([404, 410])
  const retryableGatewayError = (rawText?: string) => {
    if (!rawText) return false
    return /system\s*error/i.test(rawText) || /could\s*not\s*pars/i.test(rawText)
  }

  async function postLookupForMode(
    keyPem: string,
    mode: 'sandbox' | 'production',
    businessKeySegment: string,
    paddingMode: RsaPaddingMode,
    ciphertextEncoding: CiphertextEncoding
  ): Promise<Response> {
    const modeBaseUrl = getMonCashMiddlewareBaseUrlForMode(mode)
    const encryptedOrderId = encryptToMonCashButtonCiphertextWithKeyPem(orderId, keyPem, paddingMode, ciphertextEncoding)
    return fetch(`${modeBaseUrl}/Checkout/${businessKeySegment}/Payment/Order/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        orderId: encryptedOrderId,
      }).toString(),
    })
  }

  async function parsePaymentResponse(resp: Response): Promise<{ data?: MonCashButtonPaymentResponse; rawText?: string }> {
    const rawText = await resp.text().catch(() => '')
    const data = (() => {
      try {
        return JSON.parse(rawText) as MonCashButtonPaymentResponse
      } catch {
        return undefined
      }
    })()
    return { data, rawText }
  }

  async function tryLookupForMode(
    keyPem: string,
    businessKeySegments: Array<{ segment: string; kind: string }>,
    mode: 'sandbox' | 'production'
  ) {
    let lastAttempt:
      | {
          response: Response
          parsed: { data?: MonCashButtonPaymentResponse; rawText?: string }
          meta: { segmentHash: string; segmentKind: string; paddingMode: RsaPaddingMode; ciphertextEncoding: CiphertextEncoding }
        }
      | null = null
    let attempts = 0
    for (const ciphertextEncoding of ciphertextEncodings) {
      for (const paddingMode of paddingModes) {
        for (const segmentInfo of businessKeySegments) {
          try {
            attempts += 1
            const response = await postLookupForMode(keyPem, mode, segmentInfo.segment, paddingMode, ciphertextEncoding)
            const parsed = await parsePaymentResponse(response)

            lastAttempt = {
              response,
              parsed,
              meta: {
                segmentHash: sha256Short(segmentInfo.segment),
                segmentKind: segmentInfo.kind,
                paddingMode,
                ciphertextEncoding,
              },
            }

            if (response.ok && parsed.data?.success) {
              return { response, parsed, attempts }
            }

            const rawText = parsed.rawText || ''
            const shouldRetry =
              !response.ok
                ? (response.status === 500 ? true : retryableHttpStatuses.has(response.status))
                : !parsed.data?.success && retryableGatewayError(rawText)

            if (!shouldRetry) {
              return { response, parsed, attempts }
            }
          } catch (err: any) {
            const message = String(err?.message || err)
            if (/rsa/i.test(message)) continue
            throw err
          }
        }
      }
    }
    return lastAttempt ? { ...lastAttempt, attempts } : null
  }

  let lastError: any = null

  for (const config of lookupConfigs) {
    let keyPem: string
    try {
      keyPem = config.getKeyPem()
    } catch (err) {
      lastError = err
      continue
    }

    const configuredMode = config.configuredMode
    const fallbackMode: 'sandbox' | 'production' = configuredMode === 'sandbox' ? 'production' : 'sandbox'

    let bestAttempt: any = await tryLookupForMode(keyPem, config.businessKeySegments, configuredMode)
    let bestAttemptMode: 'sandbox' | 'production' = configuredMode

    const allowModeFallback = !(isButtonModeExplicit() && config.name === 'primary')
    if (allowModeFallback) {
      const configuredOk = !!bestAttempt?.response?.ok && !!bestAttempt?.parsed?.data?.success
      if (!configuredOk) {
        const attemptFallback = await tryLookupForMode(keyPem, config.businessKeySegments, fallbackMode)
        const fallbackOk = !!attemptFallback?.response?.ok && !!attemptFallback?.parsed?.data?.success
        if (fallbackOk) {
          bestAttempt = attemptFallback
          bestAttemptMode = fallbackMode
        } else if (!bestAttempt && attemptFallback) {
          bestAttempt = attemptFallback
          bestAttemptMode = fallbackMode
        }
      }
    }

    if (!bestAttempt) {
      lastError = new Error('MonCash Button payment lookup failed: unable to perform any attempts')
      continue
    }

    const { response, parsed } = bestAttempt
    const data = parsed.data
    if (!data) {
      lastError = new Error(
        `MonCash Button payment lookup failed (${response.status}): ${parsed.rawText || 'Invalid JSON response'}`
      )
      continue
    }

    if (!response.ok) {
      console.error('[MonCash Button] Payment lookup error:', {
        status: response.status,
        mode: configuredMode,
        attemptedMode: bestAttemptMode,
        config: config.name,
        helperVersion: MONCASH_BUTTON_HELPER_VERSION,
        modeExplicit: isButtonModeExplicit(),
        rsaPaddingExplicit: isRsaPaddingExplicit(),
        businessKeySegments: config.businessKeySegments.length,
        paddingModes: paddingModes.length,
        ciphertextEncodings: ciphertextEncodings.length,
        attempts: (bestAttempt as any)?.attempts,
        lastAttempt: (bestAttempt as any)?.meta,
      })
      lastError = new Error(data?.message || `MonCash Button payment lookup failed (${response.status})`)
      continue
    }

    return data
  }

  throw lastError || new Error('MonCash Button payment lookup failed')
}

export function isMonCashButtonConfigured(): boolean {
  const primaryOk =
    !!(process.env.MONCASH_BUTTON_BUSINESS_KEY && String(process.env.MONCASH_BUTTON_BUSINESS_KEY).trim()) &&
    !!(process.env.MONCASH_BUTTON_SECRET_API_KEY && String(process.env.MONCASH_BUTTON_SECRET_API_KEY).trim())

  const formBusiness = process.env.MONCASH_BUTTON_FORM_BUSINESS_KEY || process.env.MONCASH_BUTTON_BUSINESS_KEY
  const formSecret = process.env.MONCASH_BUTTON_FORM_SECRET_API_KEY || process.env.MONCASH_BUTTON_SECRET_API_KEY
  const formOk = !!(formBusiness && String(formBusiness).trim()) && !!(formSecret && String(formSecret).trim())

  return primaryOk || formOk
}

export interface MonCashButtonAmountCheck {
  /** Whether fulfillment may proceed. */
  ok: boolean
  /** Whether we actually compared a gateway-reported amount (false when `cost` is missing/unusable). */
  verified: boolean
  /** The HTG amount we expected to charge. */
  expected: number
  /** The HTG amount the gateway reported as paid (null when not provided). */
  paid: number | null
  /** Allowed absolute difference (covers whole-HTG rounding at the gateway). */
  tolerance: number
}

/**
 * Defense-in-depth amount check used before issuing tickets for a MonCash Button order.
 *
 * MonCash settles in HTG, and we encrypt the exact HTG amount into the checkout, so the
 * gateway's reported `cost` should match what we asked it to charge. If it doesn't, the
 * caller should refuse fulfillment (guards against underpayment, replay against a different
 * order, or tampering being treated as a completed sale).
 *
 * When the gateway omits `cost` (some Digicel responses do), we cannot verify and return
 * `{ ok: true, verified: false }` so the caller can decide whether to proceed (we proceed
 * but log, preserving the prior behavior).
 */
export function isMonCashButtonPaidAmountAcceptable(
  expectedAmount: number,
  cost: string | number | null | undefined
): MonCashButtonAmountCheck {
  const expected = Number(expectedAmount)
  const paid =
    typeof cost === 'number'
      ? cost
      : typeof cost === 'string' && cost.trim() !== ''
        ? Number(cost)
        : NaN

  const tolerance = Math.max(1, (Number.isFinite(expected) ? expected : 0) * 0.01)

  // Without a sane expected amount we have nothing to compare against; don't block.
  if (!Number.isFinite(expected) || expected <= 0) {
    return { ok: true, verified: false, expected, paid: Number.isFinite(paid) ? paid : null, tolerance }
  }

  // Gateway didn't return a usable cost; cannot verify.
  if (!Number.isFinite(paid)) {
    return { ok: true, verified: false, expected, paid: null, tolerance }
  }

  const ok = Math.abs(paid - expected) <= tolerance
  return { ok, verified: true, expected, paid, tolerance }
}
