/**
 * Vercel cron authentication: `Authorization: Bearer <CRON_SECRET>`. Fails
 * closed — no configured secret means no request is authorized.
 */
export function isAuthorizedCronRequest(
  request: Pick<Request, 'headers'>,
  secret: string | undefined = process.env.CRON_SECRET
): boolean {
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}
