import { cachified, type CacheEntry } from '@epic-web/cachified'
import { remember } from '@epic-web/remember'
import { LRUCache } from 'lru-cache'
import { getLastSuccessfulSync, SYNC_EVERY_MS } from './nrdb.server.ts'
import {
	getLastSuccessfulMtgSync,
	MTG_SYNC_EVERY_MS,
} from './scryfall.server.ts'

// Process-local: these values are closures over big lookup maps, so they
// have no business in the SQLite cache. Only a handful of keys ever exist.
const memo = remember(
	'card-data-cache',
	() => new LRUCache<string, CacheEntry>({ max: 20 }),
)

function cachedForVersion<Value>(
	key: string,
	version: number | undefined,
	ttl: number,
	getFreshValue: () => Promise<Value>,
) {
	if (version === undefined) return getFreshValue()
	return cachified({
		key: `${key}:${version}`,
		cache: memo,
		ttl,
		getFreshValue,
	})
}

/**
 * Memoise something derived from the Netrunner card tables (a lookup index,
 * a resolver) until the next NetrunnerDB sync. Card data only changes when a
 * sync runs, so the last successful sync's start time is the cache key: a new
 * sync means a new key and a fresh value; concurrent callers share one build.
 *
 * With no recorded sync (unit tests, a freshly seeded dev database) nothing is
 * cached, so tests that seed cards between runs always see their own data.
 */
export async function cachedUntilNextSync<Value>(
	key: string,
	getFreshValue: () => Promise<Value>,
): Promise<Value> {
	const lastSync = await getLastSuccessfulSync()
	return cachedForVersion(
		key,
		lastSync?.startedAt.getTime(),
		SYNC_EVERY_MS,
		getFreshValue,
	)
}

/**
 * The same for the MTG card tables, until Scryfall's data changes: keyed on
 * the bulk file the last successful sync imported, so a sync that found the
 * file unchanged keeps the cached value.
 */
export async function cachedUntilNextMtgSync<Value>(
	key: string,
	getFreshValue: () => Promise<Value>,
): Promise<Value> {
	const lastSync = await getLastSuccessfulMtgSync()
	return cachedForVersion(
		`mtg:${key}`,
		lastSync?.bulkUpdatedAt?.getTime(),
		MTG_SYNC_EVERY_MS,
		getFreshValue,
	)
}
