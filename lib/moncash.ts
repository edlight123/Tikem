/**
 * MonCash Payment Integration for Haiti
 * 
 * MonCash is Haiti's leading mobile payment service by Digicel
 * Documentation: https://sandbox.moncashbutton.digicelgroup.com/Api/
 * 
 * Environment Variables Required:
 * - MONCASH_CLIENT_ID
 * - MONCASH_SECRET_KEY
 * - MONCASH_MODE (sandbox or production)
 */

const MONCASH_SANDBOX_URL = 'https://sandbox.moncashbutton.digicelgroup.com'
const MONCASH_PRODUCTION_URL = 'https://moncashbutton.digicelgroup.com'

function getMonCashBaseUrl(): string {
  const mode = (process.env.MONCASH_MODE || 'sandbox').trim().toLowerCase()
  return mode === 'production' ? MONCASH_PRODUCTION_URL : MONCASH_SANDBOX_URL
}

interface MonCashTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

let cachedToken: { token: string; expiresAt: number } | null = null

function getJwtExpiryMs(token: string): number | null {
  // token is a JWT: header.payload.signature
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payloadB64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')

    const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8')
    const payload = JSON.parse(payloadJson)
    if (typeof payload.exp !== 'number') return null
    return payload.exp * 1000
  } catch {
    return null
  }
}

function shouldRetryWithFreshToken(status: number, bodyText: string): boolean {
  if (status !== 401) return false
  const text = (bodyText || '').toLowerCase()
  return text.includes('invalid_token') || text.includes('expired')
}

/**
 * The token request already in flight, if any. Concurrent callers (the checkout
 * route's prewarm racing its own CreatePayment, or two buyers hitting one warm
 * instance) share it instead of each paying a separate OAuth round trip to Digicel.
 */
let tokenInFlight: Promise<string> | null = null

/**
 * Index (into the attempts list below) of the auth/scope variant that last
 * minted a token. Digicel environments differ on Basic-vs-body credentials and
 * scope separators; once one works we try it FIRST, so a refresh does not burn
 * a 401 round trip per rejected variant before reaching the one that works.
 */
let preferredTokenAttempt = 0

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    console.log('[MonCash] Using cached token')
    return cachedToken.token
  }

  if (!tokenInFlight) {
    tokenInFlight = fetchAccessToken().finally(() => {
      tokenInFlight = null
    })
  }
  return tokenInFlight
}

/**
 * Start minting the gateway OAuth token in the background so a request that is
 * about to call CreatePayment finds it cached (or in flight) instead of paying
 * the Digicel round trip serially. Never throws: a failure here is ignored and
 * the real call fetches (and reports) on its own. The returned promise always
 * resolves; hand it to after()/waitUntil when the response is already sent.
 */
export function prewarmMonCashAccessToken(): Promise<void> {
  if (!isMonCashConfigured()) return Promise.resolve()
  if (cachedToken && cachedToken.expiresAt > Date.now()) return Promise.resolve()
  return getAccessToken().then(
    () => undefined,
    () => undefined
  )
}

async function fetchAccessToken(): Promise<string> {
  const rawClientId = process.env.MONCASH_CLIENT_ID
  const rawSecretKey = process.env.MONCASH_SECRET_KEY
  const mode = (process.env.MONCASH_MODE || 'sandbox').trim().toLowerCase()

  const clientId = typeof rawClientId === 'string' ? rawClientId.trim() : rawClientId
  const secretKey = typeof rawSecretKey === 'string' ? rawSecretKey.trim() : rawSecretKey

  console.log('[MonCash] Getting new token:', { mode, clientId: clientId?.substring(0, 8) + '...' })

  if (!clientId || !secretKey) {
    throw new Error('MonCash credentials not configured')
  }

  const baseUrl = getMonCashBaseUrl()

  console.log('[MonCash] Token request URL:', `${baseUrl}/Api/oauth/token`)

  const tokenUrl = `${baseUrl}/Api/oauth/token`
  const credentials = Buffer.from(`${clientId}:${secretKey}`).toString('base64')

  const makeBody = (scope: string, includeClientCredentials: boolean): string => {
    const params = new URLSearchParams()
    params.set('grant_type', 'client_credentials')
    if (scope) params.set('scope', scope)
    if (includeClientCredentials) {
      params.set('client_id', clientId)
      params.set('client_secret', secretKey)
    }
    return params.toString()
  }

  const tryTokenRequest = async (opts: {
    auth: 'basic' | 'body'
    scope: string
  }): Promise<Response> => {
    const includeClientCredentials = opts.auth === 'body'

    return fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(opts.auth === 'basic' ? { Authorization: `Basic ${credentials}` } : {}),
      },
      body: makeBody(opts.scope, includeClientCredentials),
    })
  }

  // MonCash environments vary: some accept Basic auth, others expect client_id/client_secret in the body.
  // Likewise, scope formatting may be comma- or space-separated. Try a small set of known-good variants.
  const attempts: Array<{ auth: 'basic' | 'body'; scope: string }> = [
    { auth: 'basic', scope: 'read,write' },
    { auth: 'basic', scope: 'read write' },
    { auth: 'body', scope: 'read,write' },
    { auth: 'body', scope: 'read write' },
  ]
  // Last known-good variant first; the rest keep their original order.
  const order = [
    preferredTokenAttempt,
    ...attempts.map((_, i) => i).filter((i) => i !== preferredTokenAttempt),
  ]

  let response: Response | null = null
  let lastErrorText: string | null = null
  let lastStatus: number | null = null
  let lastAttempt: { auth: 'basic' | 'body'; scope: string } | null = null

  for (const index of order) {
    const attempt = attempts[index]
    lastAttempt = attempt
    response = await tryTokenRequest(attempt)
    lastStatus = response.status
    console.log('[MonCash] Token response status:', response.status)

    if (response.ok) {
      preferredTokenAttempt = index
      break
    }

    // Only bother trying fallbacks for auth failures; otherwise fail fast.
    if (response.status !== 401) {
      lastErrorText = await response.text()
      break
    }

    lastErrorText = await response.text()
  }

  if (!response || !response.ok) {
    const errorText = lastErrorText ?? (response ? await response.text() : 'Unknown error')
    console.error('[MonCash] Token error response:', errorText)
    const attemptInfo = lastAttempt ? `auth=${lastAttempt.auth}, scope=${JSON.stringify(lastAttempt.scope)}` : 'unknown attempt'
    const clientIdHint = typeof clientId === 'string' ? `${clientId.substring(0, 8)}...` : 'missing'
    throw new Error(
      `Failed to get MonCash token (${lastStatus ?? 'no_status'}; ${attemptInfo}; mode=${mode}; clientId=${clientIdHint}): ${errorText}`
    )
  }

  const data: MonCashTokenResponse = await response.json()
  console.log('[MonCash] Token received, expires in:', data.expires_in)

  // Cache token. Prefer JWT exp when present, otherwise use expires_in.
  const jwtExpMs = getJwtExpiryMs(data.access_token)
  const expiresAt = jwtExpMs
    ? Math.max(Date.now() + 30_000, jwtExpMs - 60_000) // 60s safety buffer
    : Date.now() + Math.max(60, (data.expires_in || 3600) - 100) * 1000

  cachedToken = {
    token: data.access_token,
    expiresAt,
  }

  return data.access_token
}

interface CreatePaymentParams {
  amount: number
  reference: string // Order ID / reference
  account: string // Customer's MonCash phone number (e.g., "50938662809")
}

interface MonCashMerchantPaymentResponse {
  mode: string
  reference: string
  path: string
  amount: number
  transactionId: string
  account: string
  timestamp: number
  status: number
}

/**
 * Initiate a MonCash payment using MerchantApi
 * Customer will receive a payment request on their MonCash mobile app
 * 
 * @param amount - Amount in HTG
 * @param reference - Unique order/payment reference
 * @param account - Customer's MonCash phone number (e.g., "50938662809")
 * @returns Transaction ID and payment status
 */
export async function createMonCashPayment({ 
  amount, 
  reference,
  account,
}: CreatePaymentParams): Promise<{ transactionId: string; status: string }> {
  try {
    const baseUrl = getMonCashBaseUrl()

    console.log('[MonCash] Creating payment with MerchantApi:', { amount, reference, account, baseUrl })

    const payload = {
      reference,
      account,
      amount: parseFloat(amount.toFixed(2)),
    }
    console.log('[MonCash] Payment payload:', JSON.stringify(payload))

    // Use /MerChantApi/V1/Payment (note: MerChantApi with capital C and H as per docs)
    const doRequest = async (): Promise<Response> => {
      const token = await getAccessToken()
      return fetch(`${baseUrl}/MerChantApi/V1/Payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    }

    let response = await doRequest()

    console.log('[MonCash] Payment response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[MonCash] Payment error response:', errorText)

      // Retry once with a fresh token if the cached one expired.
      if (shouldRetryWithFreshToken(response.status, errorText)) {
        cachedToken = null
        response = await doRequest()
        console.log('[MonCash] Payment retry response status:', response.status)
        if (!response.ok) {
          const errorText2 = await response.text()
          console.error('[MonCash] Payment retry error response:', errorText2)
          throw new Error(`MonCash payment creation failed: ${errorText2}`)
        }
      } else {
        throw new Error(`MonCash payment creation failed: ${errorText}`)
      }
    }

    const data: MonCashMerchantPaymentResponse = await response.json()
    console.log('[MonCash] Payment response:', JSON.stringify(data))

    return {
      transactionId: data.transactionId,
      status: data.status === 200 ? 'successful' : 'pending',
    }
  } catch (error: any) {
    console.error('MonCash payment error:', error)
    throw error
  }
}

/**
 * Initiate a MonCash payment without waiting for completion
 * Returns immediately with pending status
 * Use checkPaymentStatus() to poll for completion
 */
export async function initiateMonCashPayment({ 
  amount, 
  reference,
  account,
}: CreatePaymentParams): Promise<{ reference: string; status: string }> {
  try {
    const baseUrl = getMonCashBaseUrl()

    console.log('[MonCash] Initiating payment:', { amount, reference, account })

    const payload = {
      reference,
      account,
      amount: parseFloat(amount.toFixed(2)),
    }

    const doRequest = async (): Promise<Response> => {
      const token = await getAccessToken()
      return fetch(`${baseUrl}/MerChantApi/V1/InitiatePayment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    }

    let response = await doRequest()

    if (!response.ok) {
      // A Response body can be read once: keep the first read and only re-read
      // the RETRIED response, or the error is masked by "Body is unusable".
      let errorText2 = await response.text()
      if (shouldRetryWithFreshToken(response.status, errorText2)) {
        cachedToken = null
        response = await doRequest()
        if (!response.ok) errorText2 = await response.text()
      }

      if (!response.ok) {
        throw new Error(`MonCash payment initiation failed: ${errorText2}`)
      }
    }

    const data = await response.json()
    console.log('[MonCash] Payment initiated:', JSON.stringify(data))

    return {
      reference: data.reference,
      status: data.message, // "pending"
    }
  } catch (error: any) {
    console.error('MonCash initiate payment error:', error)
    throw error
  }
}

interface CheckPaymentResponse {
  reference: string
  mode: string
  path: string
  amount: number
  message: string // "successful" or "pending" or "failed"
  transactionId: string
  account: string
  timestamp: number
  status: number
}

/**
 * Check the status of a MonCash payment
 * Can be called with either transactionId or reference
 */
export async function checkPaymentStatus(
  params: { transactionId: string } | { reference: string }
): Promise<CheckPaymentResponse> {
  try {
    const baseUrl = getMonCashBaseUrl()

    console.log('[MonCash] Checking payment status:', params)

    const doRequest = async (): Promise<Response> => {
      const token = await getAccessToken()
      return fetch(`${baseUrl}/MerChantApi/V1/CheckPayment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      })
    }

    let response = await doRequest()

    if (!response.ok) {
      // Read each Response body once (see initiateMonCashPayment).
      let errorText2 = await response.text()
      if (shouldRetryWithFreshToken(response.status, errorText2)) {
        cachedToken = null
        response = await doRequest()
        if (!response.ok) errorText2 = await response.text()
      }

      if (!response.ok) {
        throw new Error(`Failed to check payment status: ${errorText2}`)
      }
    }

    const data: CheckPaymentResponse = await response.json()
    console.log('[MonCash] Payment status:', JSON.stringify(data))
    
    return data
  } catch (error: any) {
    console.error('MonCash check payment error:', error)
    throw error
  }
}

export function isMonCashConfigured(): boolean {
  return !!(process.env.MONCASH_CLIENT_ID && process.env.MONCASH_SECRET_KEY)
}

export function getMonCashStatus(): string {
  if (!isMonCashConfigured()) {
    return 'not_configured'
  }
  return (process.env.MONCASH_MODE || 'sandbox').trim().toLowerCase()
}

// ============================================================================
// MonCash Button — Gateway (redirect) flow
//
// This is the standard, documented MonCash Button checkout:
//   1. POST {host}/Api/oauth/token           -> access token   (getAccessToken)
//   2. POST {host}/Api/v1/CreatePayment      -> { payment_token: { token } }
//   3. redirect the browser to
//        {host}/Moncash-middleware/Payment/Redirect?token=<token>
//   4. on return / alert, verify with
//        POST {host}/Api/v1/RetrieveOrderPayment       { orderId }
//        POST {host}/Api/v1/RetrieveTransactionPayment { transactionId }
//
// where {host} is sandbox.moncashbutton.digicelgroup.com (test) or
// moncashbutton.digicelgroup.com (live).
// ============================================================================

export interface MonCashGatewayPayment {
  /** URL to send the customer's browser to, to complete payment in MonCash. */
  redirectUrl: string
  /** The gateway payment token (also usable to build the redirect URL). */
  token: string
  orderId: string
  mode: string
  /** ISO time the gateway token dies (~10 minutes). Null if the token has no `ext` claim. */
  expiresAt: string | null
}

/** Create a MonCash Button gateway payment and return the redirect URL. */
/**
 * The gateway token is a JWT carrying `ext`, the epoch-ms moment it stops working
 * — about ten minutes after it is minted. Recording it means a buyer who went
 * looking for their phone can be told the session expired, and reconciliation
 * knows when it is safe to stop waiting on an order.
 */
function getGatewayTokenExpiry(token: string): string | null {
  const parts = String(token || '').split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='), 'base64').toString('utf8'))
    const ext = Number(payload?.ext)
    if (!Number.isFinite(ext) || ext <= 0) return null
    return new Date(ext).toISOString()
  } catch {
    return null
  }
}

export async function createMonCashGatewayPayment({
  amount,
  orderId,
}: {
  amount: number
  orderId: string
}): Promise<MonCashGatewayPayment> {
  const baseUrl = getMonCashBaseUrl()
  const payload = { amount: Number(amount), orderId: String(orderId) }

  console.log('[MonCash] CreatePayment:', { baseUrl, orderId, amount: payload.amount })

  const doRequest = async (): Promise<Response> => {
    const token = await getAccessToken()
    return fetch(`${baseUrl}/Api/v1/CreatePayment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
  }

  let response = await doRequest()
  if (!response.ok) {
    // Read each Response body once: re-reading the first one threw
    // "Body is unusable" and hid Digicel's real error message.
    let errorText2 = await response.text()
    if (shouldRetryWithFreshToken(response.status, errorText2)) {
      cachedToken = null
      response = await doRequest()
      if (!response.ok) errorText2 = await response.text()
    }
    if (!response.ok) {
      throw new Error(`MonCash CreatePayment failed (${response.status}): ${errorText2}`)
    }
  }

  const data: any = await response.json().catch(() => ({}))
  // Response shape: { payment_token: { expired, created, token }, timestamp, status }
  const gatewayToken: string =
    data?.payment_token?.token ||
    data?.payment_token?.Token ||
    data?.paymentToken?.token ||
    ''

  if (!gatewayToken) {
    throw new Error(`MonCash CreatePayment: no payment token in response: ${JSON.stringify(data)}`)
  }

  // Gateway base is {host}/Moncash-middleware; the hosted payment page is
  // {GATEWAY_BASE}/Payment/Redirect?token=<token> (per Digicel REST API docs).
  const redirectUrl = `${baseUrl}/Moncash-middleware/Payment/Redirect?token=${encodeURIComponent(gatewayToken)}`

  return {
    redirectUrl,
    token: gatewayToken,
    orderId: String(orderId),
    mode: getMonCashStatus(),
    expiresAt: getGatewayTokenExpiry(gatewayToken),
  }
}

/** Normalized payment result compatible with the checkout return handler. */
export interface MonCashGatewayVerification {
  success: boolean
  payment_status: string
  cost?: number
  reference: string
  transactionId: string
  payer?: string
  raw: any
}

function normalizeGatewayPayment(data: any): MonCashGatewayVerification {
  // Response shape: { payment: { reference, transaction_id, cost, message, payer, timestamp }, timestamp, status }
  const payment = data?.payment || data
  const message = String(payment?.message || '').trim().toLowerCase()
  // PAID only when Digicel's own payment record says so. An HTTP 200 envelope is
  // just "the API answered" — treating any 200 as paid would issue tickets for a
  // response that carries no successful payment at all.
  const success = message === 'successful'
  const costRaw = payment?.cost
  const cost = costRaw == null || costRaw === '' ? undefined : Number(costRaw)
  return {
    success,
    payment_status: payment?.message ? String(payment.message) : success ? 'successful' : 'unknown',
    cost: Number.isFinite(cost as number) ? (cost as number) : undefined,
    reference: String(payment?.reference || ''),
    transactionId: String(payment?.transaction_id || payment?.transactionId || ''),
    payer: payment?.payer ? String(payment.payer) : undefined,
    raw: data,
  }
}

async function retrieveGatewayPayment(
  endpoint: 'RetrieveOrderPayment' | 'RetrieveTransactionPayment',
  body: Record<string, string>
): Promise<MonCashGatewayVerification> {
  const baseUrl = getMonCashBaseUrl()
  const doRequest = async (): Promise<Response> => {
    const token = await getAccessToken()
    return fetch(`${baseUrl}/Api/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  let response = await doRequest()
  if (!response.ok) {
    // Read each Response body once. Re-reading the first (un-retried) response
    // threw "Body is unusable: Body has already been read" in production, which
    // made the 404 "not settled" answer below unreachable — the reconcile cron
    // logged every such order as "gateway unreachable" and left it pending.
    let errorText2 = await response.text()
    if (shouldRetryWithFreshToken(response.status, errorText2)) {
      cachedToken = null
      response = await doRequest()
      if (!response.ok) errorText2 = await response.text()
    }
    if (!response.ok) {
      // A 404 is Digicel's ANSWER, not a transport failure: it is how the gateway
      // says "this order has not settled". Both flavours arrive this way —
      // "Transaction Not Found" for an order nobody paid, and the account-level
      // rejection ("Failed to match a reason type because the Identity Type factor
      // of the credit party does not match") for one the ledger refused.
      //
      // Throwing here made the caller's `if (!isPaid)` branch unreachable, so a
      // genuinely failed payment surfaced as a generic processing error and its
      // order was left `pending` forever, with Digicel's reason swallowed.
      //
      // Anything else (401, 5xx) really is a failure to get an answer, and must
      // keep throwing — a Digicel outage must never be recorded as a failed payment.
      if (response.status === 404) {
        const parsed = (() => {
          try {
            return JSON.parse(errorText2)
          } catch {
            return { message: errorText2 || 'Transaction Not Found', status: 404 }
          }
        })()
        return normalizeGatewayPayment(parsed)
      }

      throw new Error(`MonCash ${endpoint} failed (${response.status}): ${errorText2}`)
    }
  }

  const data = await response.json().catch(() => ({}))
  return normalizeGatewayPayment(data)
}

/** Verify a MonCash Button gateway payment by our order id. */
export async function retrieveMonCashOrderPayment(orderId: string): Promise<MonCashGatewayVerification> {
  return retrieveGatewayPayment('RetrieveOrderPayment', { orderId: String(orderId) })
}

/** Verify a MonCash Button gateway payment by the gateway transaction id. */
export async function retrieveMonCashTransactionPayment(transactionId: string): Promise<MonCashGatewayVerification> {
  return retrieveGatewayPayment('RetrieveTransactionPayment', { transactionId: String(transactionId) })
}

// ============================================================================
// Prefunded / Payout (REST API)
// ============================================================================

function getMonCashRestApiBaseUrl(): string {
  // Docs: HOST_REST_API is moncashbutton.digicelgroup.com/Api (live)
  // and sandbox.moncashbutton.digicelgroup.com/Api (test).
  // Our getMonCashBaseUrl() returns https://<host>, so append /Api.
  return `${getMonCashBaseUrl()}/Api`
}

export interface MonCashPrefundedTransferParams {
  amount: number
  receiver: string
  desc: string
  reference: string
}

export interface MonCashPrefundedTransferResult {
  transactionId: string
  amount: number
  receiver: string
  message?: string
  desc?: string
  raw: any
}

export interface MonCashPrefundedBalanceResult {
  balance: number
  message?: string
  raw: any
}

export interface MonCashPrefundedStatusResult {
  transStatus: string
  raw: any
}

/**
 * Prefunded (disbursement) is a SEPARATE MonCash account from collections.
 * ---------------------------------------------------------------------
 * The payment Button and the prefunded rail share a hostname and nothing else.
 * Digicel resolves the prefunded organization from whichever OAuth client
 * authenticated, so calling /v1/PrefundedBalance with the COLLECTIONS client
 * returns 403 "the receiver organization queried by the organization entity ID
 * or short code does not exist" — measured repeatedly against production.
 *
 * No request parameter fixes that. 85 live attempts (15 query-param names x
 * the account number, the short code and the username, then the same values as
 * request headers) produced a byte-identical response every time: the
 * identifier is never sent, it is inferred from the caller. And the prefunded
 * names used as an OAuth client_id with the collections secret return 401, not
 * 403 — the API confirming a second login exists and that this is not its
 * password.
 *
 * So the prefunded calls authenticate as their own account when it is
 * configured. Without these vars everything falls back to the collections
 * token and behaviour is exactly as before, so this is inert until the
 * credentials are set.
 */
let cachedPrefundedToken: { token: string; expiresAt: number } | null = null

function hasPrefundedCredentials(): boolean {
  return Boolean(process.env.MONCASH_PREFUNDED_CLIENT_ID && process.env.MONCASH_PREFUNDED_SECRET_KEY)
}

async function getPrefundedAccessToken(): Promise<string> {
  if (cachedPrefundedToken && cachedPrefundedToken.expiresAt > Date.now()) {
    return cachedPrefundedToken.token
  }

  const secretKey = (process.env.MONCASH_PREFUNDED_SECRET_KEY || '').trim()
  if (!secretKey) throw new Error('MonCash prefunded credentials are not configured')

  /**
   * Which identifier is the OAuth client is genuinely ambiguous here: the
   * portal's prefunded credential exposes an ACCOUNT, a SHORT CODE and a
   * LOGIN NAME, and Digicel's docs do not say which of them authenticates.
   * Rather than burn a redeploy per guess, try each configured candidate.
   *
   * The auth/scope matrix is the same one the collections token already needs
   * (see getAccessToken): some MonCash environments want Basic auth, others
   * want the credentials in the body, and the scope may be comma- or
   * space-separated. The first prefunded implementation tried only
   * basic + "read,write", which is one cell of that grid — and a 401 there
   * proves nothing about the other three.
   */
  const candidates = [
    process.env.MONCASH_PREFUNDED_CLIENT_ID,
    process.env.MONCASH_PREFUNDED_USERNAME,
    process.env.MONCASH_PREFUNDED_SHORTCODE,
  ]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v, i, a) => v && a.indexOf(v) === i)

  if (candidates.length === 0) {
    throw new Error('MonCash prefunded credentials are not configured')
  }

  const variants: Array<{ auth: 'basic' | 'body'; scope: string }> = [
    { auth: 'basic', scope: 'read,write' },
    { auth: 'basic', scope: 'read write' },
    { auth: 'body', scope: 'read,write' },
    { auth: 'body', scope: 'read write' },
  ]

  const baseUrl = getMonCashBaseUrl()
  let lastStatus: number | null = null
  let lastText = ''

  for (const clientId of candidates) {
    for (const v of variants) {
      const params = new URLSearchParams()
      params.set('grant_type', 'client_credentials')
      params.set('scope', v.scope)
      if (v.auth === 'body') {
        params.set('client_id', clientId)
        params.set('client_secret', secretKey)
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      }
      if (v.auth === 'basic') {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${secretKey}`).toString('base64')}`
      }

      const response = await fetch(`${baseUrl}/Api/oauth/token`, {
        method: 'POST',
        headers,
        body: params.toString(),
      })
      const text = await response.text()

      if (response.ok) {
        const token = JSON.parse(text)?.access_token
        if (token) {
          // No secret in this line: the identifier is an account number or a
          // login name. Worth logging so the working combination is knowable
          // from production logs instead of by guesswork.
          console.log('[MonCash] prefunded auth OK:', { clientId, auth: v.auth, scope: v.scope })
          const expiresIn = Number(JSON.parse(text)?.expires_in) || 3600
          cachedPrefundedToken = { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 }
          return token
        }
      }
      lastStatus = response.status
      lastText = text
    }
  }

  throw new Error(
    `MonCash prefunded auth failed (${lastStatus}) after ${candidates.length * variants.length} attempts ` +
      `across ${candidates.length} identifier(s): ${lastText.slice(0, 200)}`
  )
}

/**
 * Bound every prefunded REST call well inside the function's own limit. A
 * Transfert that hangs until Vercel kills the function leaves the payout row
 * in `processing` with no reconciliation flag; aborting here instead throws,
 * which classifyPrefundedTransferError reads as AMBIGUOUS — the reservation is
 * held and PrefundedTransactionStatus decides, never a blind release.
 */
const MONCASH_REST_TIMEOUT_MS = 25_000

async function monCashRestRequest(path: string, init: RequestInit & { method: string }): Promise<Response> {
  const baseUrl = getMonCashRestApiBaseUrl()
  const url = `${baseUrl}${path}`

  const usePrefunded = hasPrefundedCredentials()

  const doRequest = async (): Promise<Response> => {
    const token = usePrefunded ? await getPrefundedAccessToken() : await getAccessToken()
    return fetch(url, {
      signal: AbortSignal.timeout(MONCASH_REST_TIMEOUT_MS),
      ...init,
      headers: {
        'Accept': 'application/json',
        ...(init.headers || {}),
        'Authorization': `Bearer ${token}`,
      },
    })
  }

  let response = await doRequest()
  if (!response.ok) {
    const text = await response.text()
    if (shouldRetryWithFreshToken(response.status, text)) {
      // Clear whichever cache produced the rejected token.
      if (usePrefunded) cachedPrefundedToken = null
      else cachedToken = null
      response = await doRequest()
      if (!response.ok) {
        const text2 = await response.text()
        throw new Error(`MonCash REST request failed (${response.status}): ${text2}`)
      }
      return response
    }

    throw new Error(`MonCash REST request failed (${response.status}): ${text}`)
  }

  return response
}

/**
 * Send money from your MonCash prefunded balance to a customer.
 * Docs endpoint: POST /v1/Transfert
 */
export async function moncashPrefundedTransfer(
  params: MonCashPrefundedTransferParams
): Promise<MonCashPrefundedTransferResult> {
  const payload = {
    amount: Number(params.amount),
    receiver: String(params.receiver),
    desc: String(params.desc),
    reference: String(params.reference),
  }

  const response = await monCashRestRequest('/v1/Transfert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))

  const transfer = data?.transfer || data?.transfert || data
  const transactionId = String(transfer?.transaction_id || transfer?.transactionId || '')
  const receiver = String(transfer?.receiver || payload.receiver)
  const amount = Number(transfer?.amount ?? payload.amount)

  if (!transactionId) {
    throw new Error(`Unexpected MonCash prefunded transfer response: ${JSON.stringify(data)}`)
  }

  return {
    transactionId,
    receiver,
    amount,
    message: transfer?.message,
    desc: transfer?.desc,
    raw: data,
  }
}

/**
 * Check status of a prefunded transaction.
 * Docs endpoint: POST /v1/PrefundedTransactionStatus
 */
export async function moncashPrefundedTransactionStatus(reference: string): Promise<MonCashPrefundedStatusResult> {
  const payload = { reference: String(reference) }
  const response = await monCashRestRequest('/v1/PrefundedTransactionStatus', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
  const transStatus = String(data?.transStatus || data?.status || data?.message || '')

  if (!transStatus) {
    throw new Error(`Unexpected MonCash prefunded status response: ${JSON.stringify(data)}`)
  }

  return {
    transStatus,
    raw: data,
  }
}

/**
 * Retrieve current prefunded balance.
 * Docs endpoint: GET /v1/PrefundedBalance
 */
export async function moncashPrefundedBalance(): Promise<MonCashPrefundedBalanceResult> {
  const response = await monCashRestRequest('/v1/PrefundedBalance', {
    method: 'GET',
  })

  const data = await response.json().catch(() => ({}))
  // Nested ({ balance: { balance, message } }) or flat ({ balance, message }).
  // `data.balance || data` only worked flat while the balance was 0: a funded
  // flat balance (a number) would be read as the node and parse to NaN.
  const balanceNode = data?.balance && typeof data.balance === 'object' ? data.balance : data
  const balance = Number(balanceNode?.balance)

  if (!Number.isFinite(balance)) {
    throw new Error(`Unexpected MonCash prefunded balance response: ${JSON.stringify(data)}`)
  }

  return {
    balance,
    message: balanceNode?.message,
    raw: data,
  }
}
