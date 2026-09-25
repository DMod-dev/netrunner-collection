import { remember } from '@epic-web/remember'
import { getInstanceInfo } from './litefs.server.ts'
import { isAutoSyncEnabled, syncIfDue } from './nrdb.server.ts'

const CHECK_EVERY_MS = 60 * 60 * 1000
const FIRST_CHECK_AFTER_MS = 30 * 1000

async function check() {
	try {
		// only the LiteFS primary can write to the database
		const { currentIsPrimary } = await getInstanceInfo()
		if (!currentIsPrimary) return
		if (await syncIfDue()) console.info('Started scheduled NRDB sync')
	} catch (error) {
		console.error('NRDB sync check failed', error)
	}
}

/**
 * Keep card data fresh: check hourly (and shortly after startup) whether the
 * last successful NRDB sync is over a day old, and sync if so. Checking
 * rather than syncing on a fixed timer means restarts and machines that were
 * stopped for a while catch up straight away.
 */
export function startNrdbSyncScheduler() {
	if (!isAutoSyncEnabled()) return
	// remember() keeps a single scheduler across dev-server reloads
	remember('nrdb-sync-scheduler', () => {
		setTimeout(() => void check(), FIRST_CHECK_AFTER_MS).unref()
		setInterval(() => void check(), CHECK_EVERY_MS).unref()
		return true
	})
}
