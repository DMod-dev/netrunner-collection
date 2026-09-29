import { pipeline, Readable } from 'node:stream'
import { type ReadableStream as NodeReadableStream } from 'node:stream/web'
import { StringDecoder } from 'node:string_decoder'
import { createGunzip } from 'node:zlib'
import { prisma } from './db.server.ts'
import { type MtgCardDb, type Row } from './mtg-card-db.server.ts'
import {
	createSyncRunner,
	INTERRUPTED_ERROR,
	isAutoSyncFlagOn,
} from './sync-runner.server.ts'

const SCRYFALL_API = 'https://api.scryfall.com'
// Scryfall requires a User-Agent and an Accept header on API requests
// (https://scryfall.com/docs/api), and asks for at most 10 requests a second;
// a sync makes three.
export const SCRYFALL_USER_AGENT =
	'NetrunnerCollection (+https://nr-collection.app; https://github.com/DMod-dev/netrunner-collection)'
const SCRYFALL_HEADERS = {
	accept: 'application/json',
	'user-agent': SCRYFALL_USER_AGENT,
}
const API_TIMEOUT_MS = 60_000
// the bulk file is ~80 MB gzipped; give a slow download plenty of time, but
// finish (or fail) well before the run counts as interrupted
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
// Rows per transaction: small enough that the app's own writes never wait
// long for the lock, big enough that 100k+ rows don't take thousands of
// commits.
const WRITE_BATCH_SIZE = 500

/** The parts of a Scryfall card object we keep. */
export type ScryfallCard = {
	id: string
	oracle_id?: string
	name: string
	lang: string
	layout: string
	released_at?: string
	mana_cost?: string
	cmc?: number
	type_line?: string
	oracle_text?: string
	colors?: Array<string>
	color_identity: Array<string>
	keywords?: Array<string>
	produced_mana?: Array<string>
	power?: string
	toughness?: string
	loyalty?: string
	legalities?: Record<string, string>
	game_changer?: boolean
	edhrec_rank?: number
	reserved?: boolean
	card_faces?: Array<ScryfallCardFace>
	set_id: string
	set: string
	set_name: string
	set_type: string
	collector_number: string
	rarity: string
	finishes?: Array<string>
	frame?: string
	frame_effects?: Array<string>
	promo_types?: Array<string>
	border_color?: string
	full_art?: boolean
	promo?: boolean
	digital?: boolean
	booster?: boolean
	reprint?: boolean
	artist?: string
	illustration_id?: string
	flavor_text?: string
	image_status?: string
	image_uris?: Record<string, string>
	prices?: Partial<
		Record<
			'usd' | 'usd_foil' | 'usd_etched' | 'eur' | 'eur_foil',
			string | null
		>
	>
	tcgplayer_id?: number
	cardmarket_id?: number
}

type ScryfallCardFace = {
	name: string
	oracle_id?: string
	mana_cost?: string
	cmc?: number
	type_line?: string
	oracle_text?: string
	colors?: Array<string>
	power?: string
	toughness?: string
	loyalty?: string
	defense?: string
	illustration_id?: string
	image_uris?: Record<string, string>
}

export type ScryfallSet = {
	id: string
	code: string
	name: string
	set_type: string
	released_at?: string
	card_count: number
	parent_set_code?: string
	icon_svg_uri?: string
	digital: boolean
}

type BulkDataItem = {
	type: string
	updated_at: string
	/** gzipped JSON Lines: one card object per line */
	jsonl_download_uri?: string
	/** a JSON array (older listings); read the same way */
	download_uri?: string
}

// ---------------------------------------------------------------------------
// Mapping Scryfall objects to rows
// ---------------------------------------------------------------------------

/** ",a,b," for ["a", "b"], "," for none; so `contains: ",a,"` matches exactly. */
function commaWrap(values: Iterable<string> | null | undefined) {
	const list = [...new Set(values ?? [])]
	return list.length ? `,${list.join(',')},` : ','
}

function toDate(value: string | null | undefined) {
	return value ? new Date(value) : null
}

function toPrice(value: string | null | undefined) {
	if (!value) return null
	const price = Number.parseFloat(value)
	return Number.isFinite(price) ? price : null
}

/** "Lim-Dûl's Vault" → "lim-dul's vault" */
export function stripName(name: string) {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
}

/** Reversible cards keep their Oracle id on the faces. */
export function oracleIdOf(card: ScryfallCard) {
	return card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? null
}

/** Supertypes and card types, and subtypes, of each face's type line. */
function parseTypeLines(typeLines: Array<string>) {
	const types: Array<string> = []
	const subtypes: Array<string> = []
	for (const line of typeLines) {
		const [left = '', right = ''] = line.split('—')
		types.push(...words(left))
		subtypes.push(...words(right))
	}
	return { types, subtypes }
}

function words(text: string) {
	return text.toLowerCase().split(/\s+/).filter(Boolean)
}

/** An MtgCard row (the Oracle card) from any of its printings. */
export function toMtgCard(card: ScryfallCard, oracleId: string) {
	const faces = card.card_faces ?? []
	const typeLines = card.type_line
		? card.type_line.split(' // ')
		: faces.flatMap((f) => (f.type_line ? [f.type_line] : []))
	const { types, subtypes } = parseTypeLines(typeLines)
	const legalities = Object.entries(card.legalities ?? {})
	const formatsWhere = (status: string) =>
		commaWrap(legalities.filter(([, s]) => s === status).map(([f]) => f))
	const joinFaces = (pick: (face: ScryfallCardFace) => string | undefined) =>
		faces
			.map(pick)
			.filter((value) => value)
			.join(' // ') || null
	return {
		id: oracleId,
		name: card.name,
		strippedName: stripName(card.name),
		layout: card.layout,
		// lands have an empty mana cost; store none, like faces without one
		manaCost: card.mana_cost || joinFaces((f) => f.mana_cost),
		manaValue: card.cmc ?? faces[0]?.cmc ?? 0,
		typeLine: card.type_line ?? typeLines.join(' // '),
		oracleText:
			card.oracle_text ??
			(faces
				.map((f) => f.oracle_text)
				.filter((text) => text)
				.join('\n//\n') ||
				null),
		colors: commaWrap(card.colors ?? faces.flatMap((f) => f.colors ?? [])),
		colorIdentity: commaWrap(card.color_identity),
		types: commaWrap(types),
		subtypes: commaWrap(subtypes),
		keywords: commaWrap(card.keywords?.map((k) => k.toLowerCase())),
		producedMana: commaWrap(card.produced_mana),
		power: card.power ?? faces[0]?.power ?? null,
		toughness: card.toughness ?? faces[0]?.toughness ?? null,
		loyalty: card.loyalty ?? faces[0]?.loyalty ?? null,
		legalFormats: formatsWhere('legal'),
		restrictedFormats: formatsWhere('restricted'),
		bannedFormats: formatsWhere('banned'),
		gameChanger: card.game_changer ?? false,
		edhrecRank: card.edhrec_rank ?? null,
		reserved: card.reserved ?? false,
		faces: faces.length
			? JSON.stringify(
					faces.map((f) => ({
						name: f.name,
						manaCost: f.mana_cost || undefined,
						typeLine: f.type_line,
						oracleText: f.oracle_text || undefined,
						colors: f.colors,
						power: f.power,
						toughness: f.toughness,
						loyalty: f.loyalty,
						defense: f.defense,
					})),
				)
			: null,
	}
}

/** An MtgPrinting row. */
export function toMtgPrinting(card: ScryfallCard, oracleId: string) {
	return {
		id: card.id,
		cardId: oracleId,
		setId: card.set_id,
		collectorNumber: card.collector_number,
		rarity: card.rarity,
		finishes: commaWrap(card.finishes),
		lang: card.lang,
		frame: card.frame ?? null,
		frameEffects: commaWrap(card.frame_effects),
		promoTypes: commaWrap(card.promo_types),
		borderColor: card.border_color ?? null,
		fullArt: card.full_art ?? false,
		promo: card.promo ?? false,
		booster: card.booster ?? false,
		reprint: card.reprint ?? false,
		artist: card.artist ?? null,
		illustrationId:
			card.illustration_id ?? card.card_faces?.[0]?.illustration_id ?? null,
		flavorText: card.flavor_text ?? null,
		releasedAt: toDate(card.released_at),
		imageStatus: card.image_status ?? 'missing',
		multiFaceImages:
			!card.image_uris && Boolean(card.card_faces?.[0]?.image_uris),
		priceUsd: toPrice(card.prices?.usd),
		priceUsdFoil: toPrice(card.prices?.usd_foil),
		priceUsdEtched: toPrice(card.prices?.usd_etched),
		priceEur: toPrice(card.prices?.eur),
		priceEurFoil: toPrice(card.prices?.eur_foil),
		tcgplayerId: card.tcgplayer_id ?? null,
		cardmarketId: card.cardmarket_id ?? null,
	}
}

export function toMtgSet(set: ScryfallSet) {
	return {
		id: set.id,
		code: set.code,
		name: set.name,
		setType: set.set_type,
		releasedAt: toDate(set.released_at),
		cardCount: set.card_count,
		parentSetCode: set.parent_set_code ?? null,
		iconSvgUri: set.icon_svg_uri ?? null,
		digital: set.digital,
	}
}

/** For a printing whose set isn't in /sets (shouldn't happen, but cheap). */
function setFromCard(card: ScryfallCard) {
	return {
		id: card.set_id,
		code: card.set,
		name: card.set_name,
		setType: card.set_type,
		releasedAt: toDate(card.released_at),
		cardCount: 0,
		parentSetCode: null,
		iconSvgUri: null,
		digital: false,
	}
}

// ---------------------------------------------------------------------------
// Reading from Scryfall
// ---------------------------------------------------------------------------

async function fetchScryfall(url: string, timeoutMs = API_TIMEOUT_MS) {
	const response = await fetch(url, {
		headers: SCRYFALL_HEADERS,
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!response.ok) {
		throw new Error(
			`Scryfall request failed (${response.status} ${response.statusText}): ${url}`,
		)
	}
	return response
}

async function fetchSets() {
	const sets: Array<ScryfallSet> = []
	let url: string | undefined = `${SCRYFALL_API}/sets`
	while (url) {
		const page = (await (await fetchScryfall(url)).json()) as {
			data: Array<ScryfallSet>
			has_more?: boolean
			next_page?: string
		}
		sets.push(...page.data)
		url = page.has_more ? page.next_page : undefined
	}
	return sets
}

async function fetchDefaultCardsListing() {
	const listing = (await (
		await fetchScryfall(`${SCRYFALL_API}/bulk-data`)
	).json()) as { data: Array<BulkDataItem> }
	const item = listing.data.find((d) => d.type === 'default_cards')
	const uri = item?.jsonl_download_uri ?? item?.download_uri
	if (!item || !uri) {
		throw new Error('Scryfall bulk-data has no default_cards file')
	}
	return { uri, updatedAt: new Date(item.updated_at) }
}

/**
 * Parse the bulk file one card at a time as it downloads, so memory stays
 * flat: it's ~600 MB of JSON. Handles gzipped JSON Lines and a JSON array
 * with one object per line (Scryfall's older format). Uses Node's zlib
 * stream rather than the web DecompressionStream, which buffered 100+ MB of
 * inflated output ahead of the parser.
 */
export async function* readCardObjects(
	response: Response,
): AsyncGenerator<ScryfallCard> {
	if (!response.body) throw new Error('Scryfall bulk file has no body')
	const gzipped =
		/gzip/.test(response.headers.get('content-type') ?? '') ||
		new URL(response.url || 'http://x/').pathname.endsWith('.gz')
	const source = Readable.fromWeb(response.body as NodeReadableStream)
	// pipeline() destroys every stream on an error, so the loop below throws
	const input = gzipped ? pipeline(source, createGunzip(), () => {}) : source
	const decoder = new StringDecoder('utf8')
	let buffer = ''
	for await (const chunk of input as AsyncIterable<Buffer>) {
		buffer += decoder.write(chunk)
		let start = 0
		let newline: number
		while ((newline = buffer.indexOf('\n', start)) !== -1) {
			const card = parseLine(buffer.slice(start, newline))
			if (card) yield card
			start = newline + 1
		}
		buffer = buffer.slice(start)
	}
	const last = parseLine(buffer + decoder.end())
	if (last) yield last
}

function parseLine(line: string) {
	let trimmed = line.trim()
	if (trimmed.endsWith(',')) trimmed = trimmed.slice(0, -1)
	if (!trimmed || trimmed === '[' || trimmed === ']') return null
	return JSON.parse(trimmed) as ScryfallCard
}

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------

export type ScryfallSyncSummary = {
	/** Scryfall's updated_at for the bulk file (ISO) */
	bulkUpdatedAt: string
	/** the file hadn't changed since the last import, so nothing was done */
	skipped: boolean
	sets: number
	cards: number
	printings: number
	/** rows inserted or changed (the rest were already up to date) */
	cardsWritten: number
	printingsWritten: number
	/** digital-only printings (Arena, MTGO), which aren't collected */
	digitalSkipped: number
	/** printings and cards no longer in the file */
	printingsDeleted: number
	cardsDeleted: number
	/** vanished printings kept because a user's data refers to them */
	printingsKept: number
	/** deletions weren't made because suspiciously many rows vanished */
	deletionsSkipped: boolean
	durationMs: number
}

/**
 * Deleting more than this share of printings in one run means something is
 * wrong with the file, not that Scryfall deleted them.
 */
const MAX_DELETE_SHARE = 0.1
const ALWAYS_DELETABLE = 1000

/**
 * Write sets, then cards and printings as they arrive, in batches. Returns
 * the ids seen so the sync can find what vanished.
 */
async function writeCardData(
	writer: MtgCardDb,
	sets: Array<ScryfallSet>,
	cards: AsyncIterable<ScryfallCard> | Iterable<ScryfallCard>,
	log: (message: string) => void,
) {
	for (let i = 0; i < sets.length; i += WRITE_BATCH_SIZE) {
		writer.write({ sets: sets.slice(i, i + WRITE_BATCH_SIZE).map(toMtgSet) })
	}
	const knownSets = new Set(sets.map((s) => s.id))
	const seenCards = new Set<string>()
	const seenPrintings = new Set<string>()
	let pending = emptyBatch()
	let cardsWritten = 0
	let printingsWritten = 0
	let digitalSkipped = 0

	function flush() {
		const written = writer.write(pending)
		cardsWritten += written.cards
		printingsWritten += written.printings
		pending = emptyBatch()
	}

	for await (const card of cards) {
		const oracleId = oracleIdOf(card)
		if (!oracleId || seenPrintings.has(card.id)) continue
		if (card.digital) {
			digitalSkipped++
			continue
		}
		seenPrintings.add(card.id)
		if (!knownSets.has(card.set_id)) {
			knownSets.add(card.set_id)
			pending.sets.push(setFromCard(card))
		}
		// the first printing seen carries the Oracle fields (they're the same
		// on every printing)
		if (!seenCards.has(oracleId)) {
			seenCards.add(oracleId)
			pending.cards.push(toMtgCard(card, oracleId))
		}
		pending.printings.push(toMtgPrinting(card, oracleId))
		if (pending.printings.length >= WRITE_BATCH_SIZE) {
			flush()
			if (seenPrintings.size % 20_000 < WRITE_BATCH_SIZE) {
				log(`...${seenPrintings.size} printings`)
			}
		}
	}
	flush()
	return {
		sets: knownSets.size,
		seenCards,
		seenPrintings,
		cardsWritten,
		printingsWritten,
		digitalSkipped,
	}
}

function emptyBatch() {
	return {
		sets: [] as Array<Row>,
		cards: [] as Array<Row>,
		printings: [] as Array<Row>,
	}
}

/**
 * Write Scryfall objects to the MTG tables through the sync's own mapping,
 * without fetching or deleting anything. For seeding tests and dev data.
 */
export async function importScryfallCards(
	cards: Iterable<ScryfallCard>,
	sets: Array<ScryfallSet> = [],
) {
	const db = await openMtgCardDb()
	try {
		const { seenCards, seenPrintings } = await writeCardData(
			db,
			sets,
			cards,
			() => {},
		)
		return { cards: seenCards.size, printings: seenPrintings.size }
	} finally {
		db.close()
	}
}

/** Loaded on demand: see app/utils/mtg-card-db.server.ts. */
async function openMtgCardDb() {
	const { openMtgCardDb } = await import('./mtg-card-db.server.ts')
	return openMtgCardDb()
}

async function lastImportedBulkUpdatedAt() {
	const last = await prisma.mtgSync.findFirst({
		where: { status: 'success', bulkUpdatedAt: { not: null } },
		orderBy: { startedAt: 'desc' },
		select: { bulkUpdatedAt: true },
	})
	return last?.bulkUpdatedAt ?? null
}

/**
 * Mirror Scryfall's card data (the default_cards bulk file: every card in
 * English, or its printed language when only printed in one) into the MTG
 * tables. Skips the download when the file hasn't changed since the last
 * import, unless `force`. Safe to run repeatedly: every row is upserted by its
 * Scryfall id, and nothing a user owns is deleted.
 */
export async function syncFromScryfall({
	log = () => {},
	force = false,
}: {
	log?: (message: string) => void
	force?: boolean
} = {}): Promise<ScryfallSyncSummary> {
	const start = performance.now()
	const { uri, updatedAt } = await fetchDefaultCardsListing()
	const summary: ScryfallSyncSummary = {
		bulkUpdatedAt: updatedAt.toISOString(),
		skipped: false,
		sets: 0,
		cards: 0,
		printings: 0,
		cardsWritten: 0,
		printingsWritten: 0,
		digitalSkipped: 0,
		printingsDeleted: 0,
		cardsDeleted: 0,
		printingsKept: 0,
		deletionsSkipped: false,
		durationMs: 0,
	}
	const lastImported = await lastImportedBulkUpdatedAt()
	if (!force && lastImported?.getTime() === updatedAt.getTime()) {
		log(`Scryfall's file hasn't changed since ${summary.bulkUpdatedAt}`)
		return {
			...summary,
			skipped: true,
			durationMs: Math.round(performance.now() - start),
		}
	}

	log('Fetching sets from Scryfall...')
	const sets = await fetchSets()
	log(`Streaming ${uri}...`)
	const response = await fetchScryfall(uri, DOWNLOAD_TIMEOUT_MS)

	const db = await openMtgCardDb()
	try {
		const imported = await writeCardData(
			db,
			sets,
			readCardObjects(response),
			log,
		)
		Object.assign(summary, {
			sets: imported.sets,
			cards: imported.seenCards.size,
			printings: imported.seenPrintings.size,
			cardsWritten: imported.cardsWritten,
			printingsWritten: imported.printingsWritten,
			digitalSkipped: imported.digitalSkipped,
		})
		log(
			`Imported ${summary.printings} printings of ${summary.cards} cards (${summary.printingsWritten} printings changed)`,
		)

		// Printings Scryfall no longer lists (deleted, or merged into another
		// id), then cards left without printings.
		const vanished = db.printingIdsNotIn(imported.seenPrintings)
		const existing = imported.seenPrintings.size + vanished.length
		if (
			vanished.length > ALWAYS_DELETABLE &&
			vanished.length > existing * MAX_DELETE_SHARE
		) {
			summary.deletionsSkipped = true
			log(
				`Not deleting ${vanished.length} of ${existing} printings: too many vanished at once`,
			)
		} else {
			const { deleted, kept } = db.deleteUnlessReferenced(
				'MtgPrinting',
				vanished,
			)
			summary.printingsDeleted = deleted
			summary.printingsKept = kept.length
			if (kept.length) {
				log(
					`Kept ${kept.length} printings Scryfall no longer lists because users refer to them: ${kept.slice(0, 20).join(', ')}`,
				)
			}
			// even when no printing vanished: a printing can move to another
			// Oracle id (Scryfall merges duplicates), leaving its old card empty
			summary.cardsDeleted = db.deleteUnlessReferenced(
				'MtgCard',
				db.orphanCardIds(),
			).deleted
		}
	} finally {
		db.close()
	}
	summary.durationMs = Math.round(performance.now() - start)
	return summary
}

// ---------------------------------------------------------------------------
// Runs, log and schedule
// ---------------------------------------------------------------------------

/** Scryfall refreshes the bulk file about every 12 hours. */
export const MTG_SYNC_EVERY_MS = 12 * 60 * 60 * 1000

export async function getLastSuccessfulMtgSync() {
	return prisma.mtgSync.findFirst({
		where: { status: 'success' },
		orderBy: { startedAt: 'desc' },
		select: { startedAt: true, finishedAt: true, bulkUpdatedAt: true },
	})
}

const runner = createSyncRunner({
	label: 'Scryfall',
	sync: syncFromScryfall,
	everyMs: MTG_SYNC_EVERY_MS,
	// a full import takes a few minutes; the download alone may take up to
	// DOWNLOAD_TIMEOUT_MS
	staleAfterMs: 60 * 60 * 1000,
	store: {
		start: (trigger) =>
			prisma.mtgSync.create({
				data: { status: 'running', trigger },
				select: { id: true },
			}),
		succeed: (id, summary) =>
			prisma.mtgSync.update({
				where: { id },
				data: {
					status: 'success',
					finishedAt: new Date(),
					bulkUpdatedAt: new Date(summary.bulkUpdatedAt),
					summary: JSON.stringify(summary),
				},
			}),
		fail: (id, error) =>
			prisma.mtgSync.update({
				where: { id },
				data: { status: 'error', finishedAt: new Date(), error },
			}),
		interruptStale: (startedBefore) =>
			prisma.mtgSync.updateMany({
				where: { status: 'running', startedAt: { lt: startedBefore } },
				data: {
					status: 'error',
					finishedAt: new Date(),
					error: INTERRUPTED_ERROR,
				},
			}),
		countRunning: () => prisma.mtgSync.count({ where: { status: 'running' } }),
		lastSuccessStartedAt: async () =>
			(await getLastSuccessfulMtgSync())?.startedAt ?? null,
	},
})

export const {
	isSyncRunning: isMtgSyncRunning,
	runRecordedSync: runRecordedMtgSync,
	startSyncInBackground: startMtgSyncInBackground,
	syncIfDue: mtgSyncIfDue,
} = runner

export function isMtgAutoSyncEnabled() {
	return isAutoSyncFlagOn(process.env.MTG_AUTO_SYNC)
}
