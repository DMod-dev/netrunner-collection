import { remember } from '@epic-web/remember'
import { getInstanceInfo } from './litefs.server.ts'
import { isAutoSyncEnabled, syncIfDue } from './nrdb.server.ts'
import { isMtgAutoSyncEnabled, mtgSyncIfDue } from './scryfall.server.ts'

const CHECK_EVERY_MS = 60 * 60 * 1000

function startSyncScheduler({
	key,
	label,
	isEnabled,
	syncIfDue,
	firstCheckAfterMs,
}: {
	key: string
	label: string
	isEnabled: () => boolean
	syncIfDue: () => Promise<boolean>
	firstCheckAfterMs: number
}) {
	if (!isEnabled()) return
	async function check() {
		try {
			// only the LiteFS primary can write to the database
			const { currentIsPrimary } = await getInstanceInfo()
			if (!currentIsPrimary) return
			if (await syncIfDue()) console.info(`Started scheduled ${label} sync`)
		} catch (error) {
			console.error(`${label} sync check failed`, error)
		}
	}
	// remember() keeps a single scheduler across dev-server reloads
	remember(key, () => {
		setTimeout(() => void check(), firstCheckAfterMs).unref()
		setInterval(() => void check(), CHECK_EVERY_MS).unref()
		return true
	})
}

/**
 * Keep card data fresh: check hourly (and shortly after startup) whether each
 * source's last successful sync is old enough (a day for NetrunnerDB, 12 hours
 * for Scryfall), and sync if so. Checking rather than syncing on a fixed timer
 * means restarts and machines that were stopped for a while catch up straight
 * away. The first checks are staggered so the two imports don't compete for
 * the write lock (or the 512 MB machine's memory) at startup.
 */
export function startCardSyncSchedulers() {
	startSyncScheduler({
		key: 'nrdb-sync-scheduler',
		label: 'NRDB',
		isEnabled: isAutoSyncEnabled,
		syncIfDue: () => syncIfDue(),
		firstCheckAfterMs: 30 * 1000,
	})
	startSyncScheduler({
		key: 'scryfall-sync-scheduler',
		label: 'Scryfall',
		isEnabled: isMtgAutoSyncEnabled,
		syncIfDue: () => mtgSyncIfDue(),
		firstCheckAfterMs: 3 * 60 * 1000,
	})
}
