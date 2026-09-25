import { remember } from '@epic-web/remember'

/** How long the same address waits before we email it again for the same reason. */
export const EMAIL_COOLDOWN_MS = 60_000

// Recent sends by `${kind}:${recipient}` → time sent. Pruned as it grows, and
// per process: a restart forgets cooldowns, which only means one extra email.
const recentSends = remember('email-cooldowns', () => new Map<string, number>())

function keyFor(kind: string, recipient: string) {
	return `${kind}:${recipient.trim().toLowerCase()}`
}

/**
 * Claim the right to send one `kind` of email to `recipient`. Returns false
 * when one went out less than EMAIL_COOLDOWN_MS ago, so a double-submit, or a
 * flood of submissions for someone else's address, results in one email
 * rather than a stream of them. Pair with `releaseEmailCooldown` when the send
 * then fails, so the person can try again straight away.
 */
export function claimEmailCooldown(
	kind: string,
	recipient: string,
	now = Date.now(),
): boolean {
	const key = keyFor(kind, recipient)
	const last = recentSends.get(key)
	if (last !== undefined && now - last < EMAIL_COOLDOWN_MS) return false
	if (recentSends.size >= 1000) {
		for (const [k, sentAt] of recentSends) {
			if (now - sentAt >= EMAIL_COOLDOWN_MS) recentSends.delete(k)
		}
	}
	recentSends.set(key, now)
	return true
}

export function releaseEmailCooldown(kind: string, recipient: string) {
	recentSends.delete(keyFor(kind, recipient))
}
