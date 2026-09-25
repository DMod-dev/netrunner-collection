import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'

const NRDB_API = 'https://api.netrunnerdb.com/api/v3/public'
// Identify ourselves so NRDB's maintainers know who's calling and how to
// reach us (the repo's issues) if our traffic ever causes trouble.
export const NRDB_USER_AGENT =
	'NetrunnerCollection (+https://nr-collection.app; https://github.com/DMod-dev/netrunner-collection)'
export const NRDB_JSON_API_HEADERS = {
	accept: 'application/vnd.api+json',
	'user-agent': NRDB_USER_AGENT,
}
const PAGE_SIZE = 1000
// Keep each transaction small enough that SQLite doesn't hold the write lock
// for long while the app is serving requests.
const WRITE_BATCH_SIZE = 200

type JsonApiResource<Attributes> = {
	id: string
	type: string
	attributes: Attributes
}

type JsonApiPage<Attributes> = {
	data: Array<JsonApiResource<Attributes>>
	links?: { next?: string | null }
}

type NrdbFaction = { name: string; side_id: string; is_mini: boolean }
type NrdbCardType = { name: string }
type NrdbFormat = { name: string; active_card_pool_id: string | null }
type NrdbCycle = {
	name: string
	position: number
	date_release: string | null
	released_by: string | null
}
type NrdbSet = {
	name: string
	position: number
	size: number
	card_cycle_id: string
	card_set_type_id: string
	date_release: string | null
	released_by: string | null
}
type NrdbCard = {
	title: string
	stripped_title: string
	side_id: string
	faction_id: string
	card_type_id: string
	text: string | null
	stripped_text: string | null
	display_subtypes: string | null
	is_unique: boolean
	deck_limit: number
	cost: string | null
	influence_cost: number | null
	card_pool_ids: Array<string>
}
type NrdbPrinting = {
	card_id: string
	card_set_id: string
	position: number
	quantity: number
	display_illustrators: string | null
	flavor: string | null
	date_release: string | null
	is_latest_printing: boolean
	images?: {
		nrdb_classic?: { small?: string; large?: string }
	}
}

async function fetchAll<Attributes>(
	resource: string,
): Promise<Array<JsonApiResource<Attributes>>> {
	const results: Array<JsonApiResource<Attributes>> = []
	let url: string | null | undefined =
		`${NRDB_API}/${resource}?page%5Bsize%5D=${PAGE_SIZE}`
	while (url) {
		const response = await fetch(url, { headers: NRDB_JSON_API_HEADERS })
		if (!response.ok) {
			throw new Error(
				`NRDB request failed (${response.status} ${response.statusText}): ${url}`,
			)
		}
		const page = (await response.json()) as JsonApiPage<Attributes>
		results.push(...page.data)
		url = page.links?.next
	}
	return results
}

function toDate(value: string | null | undefined) {
	return value ? new Date(value) : null
}

async function writeInBatches<T>(
	items: Array<T>,
	toQuery: (item: T) => Prisma.PrismaPromise<unknown>,
) {
	for (let i = 0; i < items.length; i += WRITE_BATCH_SIZE) {
		await prisma.$transaction(items.slice(i, i + WRITE_BATCH_SIZE).map(toQuery))
	}
}

export type NrdbSyncSummary = {
	factions: number
	cardTypes: number
	cycles: number
	sets: number
	cards: number
	printings: number
	durationMs: number
}

/**
 * Mirror NetrunnerDB's card database into our tables. Safe to run repeatedly:
 * every row is upserted by its NRDB id, and nothing a user owns is touched.
 */
export async function syncFromNrdb({
	log = () => {},
}: { log?: (message: string) => void } = {}): Promise<NrdbSyncSummary> {
	const start = performance.now()

	log('Fetching from NetrunnerDB...')
	const [factions, cardTypes, formats, cycles, sets, cards, printings] =
		await Promise.all([
			fetchAll<NrdbFaction>('factions'),
			fetchAll<NrdbCardType>('card_types'),
			fetchAll<NrdbFormat>('formats'),
			fetchAll<NrdbCycle>('card_cycles'),
			fetchAll<NrdbSet>('card_sets'),
			fetchAll<NrdbCard>('cards'),
			fetchAll<NrdbPrinting>('printings'),
		])
	log(
		`Fetched ${cards.length} cards and ${printings.length} printings in ${sets.length} sets`,
	)

	// A card is legal in a format if it's in that format's current card pool.
	const activePools = formats
		.filter((f) => f.attributes.active_card_pool_id)
		.map((f) => ({ formatId: f.id, poolId: f.attributes.active_card_pool_id! }))
	function legalFormatsFor(card: NrdbCard) {
		const ids = activePools
			.filter(({ poolId }) => card.card_pool_ids.includes(poolId))
			.map(({ formatId }) => formatId)
		return `,${ids.join(',')}${ids.length ? ',' : ''}`
	}

	await writeInBatches(factions, ({ id, attributes: a }) => {
		const data = { name: a.name, sideId: a.side_id, isMini: a.is_mini }
		return prisma.faction.upsert({
			where: { id },
			create: { id, ...data },
			update: data,
		})
	})
	await writeInBatches(cardTypes, ({ id, attributes: a }) =>
		prisma.cardType.upsert({
			where: { id },
			create: { id, name: a.name },
			update: { name: a.name },
		}),
	)
	await writeInBatches(cycles, ({ id, attributes: a }) => {
		const data = {
			name: a.name,
			position: a.position,
			dateRelease: toDate(a.date_release),
			releasedBy: a.released_by,
		}
		return prisma.cardCycle.upsert({
			where: { id },
			create: { id, ...data },
			update: data,
		})
	})
	await writeInBatches(sets, ({ id, attributes: a }) => {
		const data = {
			name: a.name,
			position: a.position,
			size: a.size,
			setTypeId: a.card_set_type_id,
			cycleId: a.card_cycle_id,
			dateRelease: toDate(a.date_release),
			releasedBy: a.released_by,
		}
		return prisma.cardSet.upsert({
			where: { id },
			create: { id, ...data },
			update: data,
		})
	})
	log('Writing cards...')
	await writeInBatches(cards, ({ id, attributes: a }) => {
		const data = {
			title: a.title,
			strippedTitle: a.stripped_title,
			sideId: a.side_id,
			factionId: a.faction_id,
			typeId: a.card_type_id,
			text: a.text,
			strippedText: a.stripped_text,
			displaySubtypes: a.display_subtypes,
			isUnique: a.is_unique,
			deckLimit: a.deck_limit,
			cost: a.cost,
			influenceCost: a.influence_cost,
			legalFormats: legalFormatsFor(a),
		}
		return prisma.card.upsert({
			where: { id },
			create: { id, ...data },
			update: data,
		})
	})
	log('Writing printings...')
	await writeInBatches(printings, ({ id, attributes: a }) => {
		const data = {
			cardId: a.card_id,
			setId: a.card_set_id,
			position: a.position,
			quantity: a.quantity,
			illustrator: a.display_illustrators,
			flavor: a.flavor,
			dateRelease: toDate(a.date_release),
			isLatest: a.is_latest_printing,
			imageSmall: a.images?.nrdb_classic?.small ?? null,
			imageLarge: a.images?.nrdb_classic?.large ?? null,
		}
		return prisma.printing.upsert({
			where: { id },
			create: { id, ...data },
			update: data,
		})
	})

	return {
		factions: factions.length,
		cardTypes: cardTypes.length,
		cycles: cycles.length,
		sets: sets.length,
		cards: cards.length,
		printings: printings.length,
		durationMs: Math.round(performance.now() - start),
	}
}

export type SyncTrigger = 'schedule' | 'manual' | 'cli'

/** How often card data is re-synced. */
export const SYNC_EVERY_MS = 24 * 60 * 60 * 1000
/** A sync still "running" after this long was interrupted (e.g. a restart). */
const STALE_AFTER_MS = 15 * 60 * 1000

// guards against two syncs in this process; the "running" row covers restarts
let syncInProgress = false

/**
 * Whether a sync is currently running. Rows left "running" by a process that
 * died mid-sync are marked as interrupted so they don't block future syncs.
 */
export async function isSyncRunning() {
	return syncInProgress || (await isSyncRunningInDb())
}

async function isSyncRunningInDb() {
	await prisma.nrdbSync.updateMany({
		where: {
			status: 'running',
			startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
		},
		data: {
			status: 'error',
			finishedAt: new Date(),
			error: 'Interrupted before it finished',
		},
	})
	return (await prisma.nrdbSync.count({ where: { status: 'running' } })) > 0
}

/** Run a sync and record the outcome in the NrdbSync table. */
export async function runRecordedSync({
	trigger = 'cli',
	...options
}: Parameters<typeof syncFromNrdb>[0] & { trigger?: SyncTrigger } = {}) {
	syncInProgress = true
	const record = await prisma.nrdbSync.create({
		data: { status: 'running', trigger },
		select: { id: true },
	})
	try {
		const summary = await syncFromNrdb(options)
		await prisma.nrdbSync.update({
			where: { id: record.id },
			data: {
				status: 'success',
				finishedAt: new Date(),
				summary: JSON.stringify(summary),
			},
		})
		return summary
	} catch (error) {
		await prisma.nrdbSync.update({
			where: { id: record.id },
			data: {
				status: 'error',
				finishedAt: new Date(),
				error: error instanceof Error ? error.message : String(error),
			},
		})
		throw error
	} finally {
		syncInProgress = false
	}
}

/**
 * Start a sync without waiting for it (it takes ~20s). Returns false if one
 * is already running.
 */
export async function startSyncInBackground(trigger: SyncTrigger) {
	// claim the flag before awaiting anything, so two requests arriving
	// together can't both start a sync
	if (syncInProgress) return false
	syncInProgress = true
	let runningElsewhere: boolean
	try {
		runningElsewhere = await isSyncRunningInDb()
	} catch (error) {
		syncInProgress = false
		throw error
	}
	if (runningElsewhere) {
		syncInProgress = false
		return false
	}
	runRecordedSync({ trigger }).catch((error: unknown) => {
		console.error('NRDB sync failed', error)
	})
	return true
}

export async function getLastSuccessfulSync() {
	return prisma.nrdbSync.findFirst({
		where: { status: 'success' },
		orderBy: { startedAt: 'desc' },
		select: { startedAt: true, finishedAt: true },
	})
}

/** Sync if the last successful sync is older than SYNC_EVERY_MS. */
export async function syncIfDue({ now = Date.now() } = {}) {
	const last = await getLastSuccessfulSync()
	if (last && now - last.startedAt.getTime() < SYNC_EVERY_MS) return false
	return startSyncInBackground('schedule')
}

export function isAutoSyncEnabled() {
	return (
		process.env.NRDB_AUTO_SYNC !== 'false' &&
		process.env.NODE_ENV !== 'test' &&
		// dev and e2e runs use mocks; sync those by hand with npm run sync:nrdb
		process.env.MOCKS !== 'true'
	)
}
