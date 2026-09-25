import { cachified, type CacheEntry } from '@epic-web/cachified'
import { remember } from '@epic-web/remember'
import { LRUCache } from 'lru-cache'
import { getLastSuccessfulSync, SYNC_EVERY_MS } from './nrdb.server.ts'

// Process-local: these values are closures over big lookup maps, so they
// have no business in the SQLite cache. Only a handful of keys ever exist.
const memo = remember(
	'card-data-cache',
	() => new LRUCache<string, CacheEntry>({ max: 20 }),
)

/**
 * Memoise something derived from the card tables (a lookup index, a resolver)
 * until the next NetrunnerDB sync. Card data only changes when a sync runs,
 * so the last successful sync's start time is the cache key: a new sync means
 * a new key and a fresh value; concurrent callers share one build.
 *
 * With no recorded sync (unit tests, a freshly seeded dev database) nothing is
 * cached, so tests that seed cards between runs always see their own data.
 */
export async function cachedUntilNextSync<Value>(
	key: string,
	getFreshValue: () => Promise<Value>,
): Promise<Value> {
	const lastSync = await getLastSuccessfulSync()
	if (!lastSync) return getFreshValue()
	return cachified({
		key: `${key}:${lastSync.startedAt.getTime()}`,
		cache: memo,
		ttl: SYNC_EVERY_MS,
		getFreshValue,
	})
}
