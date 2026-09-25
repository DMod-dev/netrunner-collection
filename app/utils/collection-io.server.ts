import { type Prisma } from '@prisma/client'
import { cachedUntilNextSync } from './card-data-cache.server.ts'
import { MAX_QUANTITY } from './collection.ts'
import { prisma } from './db.server.ts'
import { normalizeTitle } from './deck-check.server.ts'

export const EXPORT_FORMAT = 'netrunner-collection'
export const EXPORT_VERSION = 1
export const MAX_IMPORT_ROWS = 20_000

export type CollectionRow = {
	printingId: string
	card: string
	set: string
	/** empty for plain copies, otherwise the custom version's label */
	version: string
	quantity: number
	notes: string
}

const CSV_COLUMNS = [
	['printing_id', 'printingId'],
	['card', 'card'],
	['set', 'set'],
	['version', 'version'],
	['quantity', 'quantity'],
	['notes', 'notes'],
] as const

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function getCollectionRows(
	userId: string,
): Promise<Array<CollectionRow>> {
	const printingSelect = {
		id: true,
		position: true,
		card: { select: { title: true } },
		set: { select: { name: true, dateRelease: true } },
	} as const
	const [entries, variants] = await Promise.all([
		prisma.collectionEntry.findMany({
			where: { userId, quantity: { gt: 0 } },
			select: { quantity: true, printing: { select: printingSelect } },
		}),
		prisma.variant.findMany({
			where: { userId },
			select: {
				label: true,
				notes: true,
				quantity: true,
				printing: { select: printingSelect },
			},
		}),
	])
	const rows = [
		...entries.map((e) => ({ ...e, label: '', notes: null })),
		...variants,
	]
	// set release order, then position in set, then plain before versions
	rows.sort(
		(a, b) =>
			(a.printing.set.dateRelease?.getTime() ?? 0) -
				(b.printing.set.dateRelease?.getTime() ?? 0) ||
			a.printing.set.name.localeCompare(b.printing.set.name) ||
			a.printing.position - b.printing.position ||
			a.label.localeCompare(b.label),
	)
	return rows.map((row) => ({
		printingId: row.printing.id,
		card: row.printing.card.title,
		set: row.printing.set.name,
		version: row.label,
		quantity: row.quantity,
		notes: row.notes ?? '',
	}))
}

function csvField(value: string | number) {
	const text = String(value)
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(rows: Array<CollectionRow>) {
	const lines = [
		CSV_COLUMNS.map(([header]) => header).join(','),
		...rows.map((row) =>
			CSV_COLUMNS.map(([, key]) => csvField(row[key])).join(','),
		),
	]
	return lines.join('\r\n') + '\r\n'
}

export function rowsToJson(rows: Array<CollectionRow>) {
	return JSON.stringify(
		{
			format: EXPORT_FORMAT,
			version: EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			cards: rows,
		},
		null,
		2,
	)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): Array<Array<string>> {
	const records: Array<Array<string>> = []
	let record: Array<string> = []
	let field = ''
	let inQuotes = false
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!
		if (inQuotes) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					field += '"'
					i++
				} else {
					inQuotes = false
				}
			} else {
				field += char
			}
		} else if (char === '"') {
			inQuotes = true
		} else if (char === ',') {
			record.push(field)
			field = ''
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[i + 1] === '\n') i++
			record.push(field)
			records.push(record)
			record = []
			field = ''
		} else {
			field += char
		}
	}
	if (field !== '' || record.length) {
		record.push(field)
		records.push(record)
	}
	// drop blank lines
	return records.filter((r) => r.some((f) => f.trim() !== ''))
}

type RawRow = {
	line: number
	printingId?: string
	card?: string
	set?: string
	version?: string
	quantity?: string
	notes?: string
}

const HEADER_ALIASES: Record<string, keyof Omit<RawRow, 'line'>> = {
	printing_id: 'printingId',
	printingid: 'printingId',
	printing: 'printingId',
	code: 'printingId',
	nrdb_code: 'printingId',
	card: 'card',
	card_name: 'card',
	title: 'card',
	name: 'card',
	set: 'set',
	set_name: 'set',
	pack: 'set',
	version: 'version',
	variant: 'version',
	label: 'version',
	quantity: 'quantity',
	qty: 'quantity',
	count: 'quantity',
	copies: 'quantity',
	owned: 'quantity',
	notes: 'notes',
}

function headerKey(header: string) {
	return HEADER_ALIASES[
		header
			.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, '_')
	]
}

function rawRowsFromCsv(text: string): Array<RawRow> {
	const [header, ...records] = parseCsv(text.replace(/^﻿/, ''))
	if (!header) return []
	const keys = header.map(headerKey)
	if (
		!keys.includes('quantity') ||
		!keys.some((k) => k === 'printingId' || k === 'card')
	) {
		throw new ImportFormatError(
			'The first row must be a header with a "quantity" column and either "printing_id" or "card".',
		)
	}
	return records.map((record, index) => {
		const row: RawRow = { line: index + 2 }
		keys.forEach((key, i) => {
			if (key) row[key] = record[i]?.trim()
		})
		return row
	})
}

function rawRowsFromJson(text: string): Array<RawRow> {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		throw new ImportFormatError("That isn't valid JSON.")
	}
	const list = Array.isArray(parsed)
		? parsed
		: (parsed as { cards?: unknown } | null)?.cards
	if (!Array.isArray(list)) {
		throw new ImportFormatError(
			'Expected a JSON export from this app (an object with a "cards" list).',
		)
	}
	return list.map((item, index) => {
		const row: RawRow = { line: index + 1 }
		if (item && typeof item === 'object') {
			for (const [key, value] of Object.entries(item)) {
				const target = headerKey(key.replace(/([a-z])([A-Z])/g, '$1_$2'))
				if (target && value != null) row[target] = String(value).trim()
			}
		}
		return row
	})
}

export class ImportFormatError extends Error {}

export type ParsedImport = {
	format: 'csv' | 'json'
	/** plain copies per printing id */
	plain: Map<string, number>
	/** custom versions keyed by `${printingId}\n${label}` */
	variants: Map<
		string,
		{
			printingId: string
			label: string
			notes: string | null
			quantity: number
		}
	>
	rowCount: number
	errors: Array<{ line: number; message: string }>
}

// Resolving names needs every printing, so the resolver is kept until the
// next sync rather than rebuilt for each import preview.
function getPrintingResolver() {
	return cachedUntilNextSync(
		'collection-import:printing-resolver',
		buildPrintingResolver,
	)
}

async function buildPrintingResolver() {
	const printings = await prisma.printing.findMany({
		orderBy: { dateRelease: 'desc' },
		select: {
			id: true,
			card: { select: { title: true, strippedTitle: true } },
			set: { select: { id: true, name: true } },
		},
	})
	const ids = new Set(printings.map((p) => p.id))
	const byCardAndSet = new Map<string, string>()
	const newestByCard = new Map<string, string>()
	for (const p of printings) {
		for (const title of [p.card.title, p.card.strippedTitle]) {
			const card = normalizeTitle(title)
			for (const set of [p.set.name, p.set.id]) {
				byCardAndSet.set(`${card}\n${normalizeTitle(set)}`, p.id)
			}
			// printings are newest first, so keep the first one seen
			if (!newestByCard.has(card)) newestByCard.set(card, p.id)
		}
	}
	return (row: RawRow): string | null => {
		if (row.printingId) {
			const id = row.printingId
			// spreadsheets like to turn "01110" into 1110
			const padded = /^\d+$/.test(id) ? id.padStart(5, '0') : id
			if (ids.has(padded)) return padded
		}
		if (row.card) {
			const card = normalizeTitle(row.card)
			if (row.set) {
				return byCardAndSet.get(`${card}\n${normalizeTitle(row.set)}`) ?? null
			}
			return newestByCard.get(card) ?? null
		}
		return null
	}
}

export async function parseImport(text: string): Promise<ParsedImport> {
	const trimmed = text.trim()
	const format =
		trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'csv'
	const rawRows =
		format === 'json' ? rawRowsFromJson(trimmed) : rawRowsFromCsv(trimmed)
	if (rawRows.length > MAX_IMPORT_ROWS) {
		throw new ImportFormatError(
			`That file has ${rawRows.length} rows; the limit is ${MAX_IMPORT_ROWS}.`,
		)
	}

	const resolve = await getPrintingResolver()
	const result: ParsedImport = {
		format,
		plain: new Map(),
		variants: new Map(),
		rowCount: rawRows.length,
		errors: [],
	}
	for (const row of rawRows) {
		const quantity = Number(row.quantity)
		if (
			!Number.isInteger(quantity) ||
			quantity < 0 ||
			quantity > MAX_QUANTITY
		) {
			result.errors.push({
				line: row.line,
				message: `Quantity "${row.quantity ?? ''}" isn't a whole number from 0 to ${MAX_QUANTITY}.`,
			})
			continue
		}
		const printingId = resolve(row)
		if (!printingId) {
			const what = row.printingId
				? `printing "${row.printingId}"`
				: `"${row.card ?? ''}"${row.set ? ` in ${row.set}` : ''}`
			result.errors.push({ line: row.line, message: `Couldn't find ${what}.` })
			continue
		}
		if (quantity === 0) continue
		const label = row.version?.trim()
		if (label) {
			const key = `${printingId}\n${label}`
			const existing = result.variants.get(key)
			result.variants.set(key, {
				printingId,
				label: label.slice(0, 80),
				notes: row.notes?.slice(0, 500) || existing?.notes || null,
				quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + quantity),
			})
		} else {
			result.plain.set(
				printingId,
				Math.min(MAX_QUANTITY, (result.plain.get(printingId) ?? 0) + quantity),
			)
		}
	}
	return result
}

export function summarizeImport(parsed: ParsedImport) {
	const plainCopies = [...parsed.plain.values()].reduce((a, b) => a + b, 0)
	const variantCopies = [...parsed.variants.values()].reduce(
		(a, v) => a + v.quantity,
		0,
	)
	return {
		format: parsed.format,
		rowCount: parsed.rowCount,
		printings: parsed.plain.size,
		versions: parsed.variants.size,
		copies: plainCopies + variantCopies,
		errors: parsed.errors.slice(0, 50),
		errorCount: parsed.errors.length,
	}
}

export type ImportMode = 'add' | 'replace'

/**
 * - "add": imported counts are added to what's already there (a version
 *   with the same label on the same printing is merged).
 * - "replace": the collection becomes exactly the imported file.
 */
export async function applyImport(
	userId: string,
	parsed: ParsedImport,
	mode: ImportMode,
) {
	const writes: Array<Prisma.PrismaPromise<unknown>> = []
	const clamp = (n: number) => Math.min(MAX_QUANTITY, n)

	if (mode === 'replace') {
		writes.push(
			prisma.collectionEntry.deleteMany({ where: { userId } }),
			prisma.variant.deleteMany({ where: { userId } }),
			prisma.collectionEntry.createMany({
				data: [...parsed.plain].map(([printingId, quantity]) => ({
					userId,
					printingId,
					quantity,
				})),
			}),
			prisma.variant.createMany({
				data: [...parsed.variants.values()].map((v) => ({ userId, ...v })),
			}),
		)
		await prisma.$transaction(writes)
		return
	}

	const [entries, variants] = await Promise.all([
		prisma.collectionEntry.findMany({
			where: { userId, printingId: { in: [...parsed.plain.keys()] } },
			select: { printingId: true, quantity: true },
		}),
		prisma.variant.findMany({
			where: {
				userId,
				printingId: {
					in: [...parsed.variants.values()].map((v) => v.printingId),
				},
			},
			select: { id: true, printingId: true, label: true, quantity: true },
		}),
	])
	const currentPlain = new Map(entries.map((e) => [e.printingId, e.quantity]))
	for (const [printingId, quantity] of parsed.plain) {
		const next = clamp((currentPlain.get(printingId) ?? 0) + quantity)
		writes.push(
			prisma.collectionEntry.upsert({
				where: { userId_printingId: { userId, printingId } },
				create: { userId, printingId, quantity: next },
				update: { quantity: next },
			}),
		)
	}
	const currentVariants = new Map(
		variants.map((v) => [`${v.printingId}\n${v.label}`, v]),
	)
	for (const [key, variant] of parsed.variants) {
		const existing = currentVariants.get(key)
		writes.push(
			existing
				? prisma.variant.update({
						where: { id: existing.id },
						data: { quantity: clamp(existing.quantity + variant.quantity) },
					})
				: prisma.variant.create({ data: { userId, ...variant } }),
		)
	}
	await prisma.$transaction(writes)
}
