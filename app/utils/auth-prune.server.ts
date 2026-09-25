import { remember } from '@epic-web/remember'
import { prisma } from './db.server.ts'
import { getInstanceInfo } from './litefs.server.ts'

const PRUNE_EVERY_MS = 60 * 60 * 1000
const FIRST_PRUNE_AFTER_MS = 60 * 1000

/**
 * Deletes sessions and one-time codes that can no longer be used. Nothing
 * reads them once expired (every lookup filters on the expiry), so this only
 * keeps the tables from growing forever.
 */
export async function pruneExpiredAuthRecords(now = new Date()) {
	const [sessions, verifications] = await prisma.$transaction([
		prisma.session.deleteMany({ where: { expirationDate: { lt: now } } }),
		prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
	])
	return { sessions: sessions.count, verifications: verifications.count }
}

async function prune() {
	try {
		// only the LiteFS primary can write to the database
		const { currentIsPrimary } = await getInstanceInfo()
		if (!currentIsPrimary) return
		const pruned = await pruneExpiredAuthRecords()
		if (pruned.sessions || pruned.verifications) {
			console.info(
				`Pruned ${pruned.sessions} expired sessions and ${pruned.verifications} expired verifications`,
			)
		}
	} catch (error) {
		console.error('Pruning expired sessions failed', error)
	}
}

export function startAuthPruneScheduler() {
	if (process.env.NODE_ENV === 'test') return
	// remember() keeps a single timer across dev-server reloads
	remember('auth-prune-scheduler', () => {
		setTimeout(() => void prune(), FIRST_PRUNE_AFTER_MS).unref()
		setInterval(() => void prune(), PRUNE_EVERY_MS).unref()
		return true
	})
}
