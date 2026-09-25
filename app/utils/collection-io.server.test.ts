import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import {
	applyImport,
	getCollectionRows,
	ImportFormatError,
	parseCsv,
	parseImport,
	rowsToCsv,
	rowsToJson,
} from './collection-io.server.ts'
import { prisma } from './db.server.ts'

test('parseCsv handles quotes, escaped quotes, commas and CRLF', () => {
	expect(parseCsv('a,b,c\r\n"Hello, world","say ""hi""",3\n\nx,,\n')).toEqual([
		['a', 'b', 'c'],
		['Hello, world', 'say "hi"', '3'],
		['x', '', ''],
	])
})

async function insertPrintings() {
	await prisma.faction.create({
		data: { id: 'neutral_corp', name: 'Neutral Corp', sideId: 'corp' },
	})
	await prisma.cardType.create({ data: { id: 'operation', name: 'Operation' } })
	for (const [id, name, year] of [
		['core', 'Core Set', 2012],
		['sg', 'System Gateway', 2021],
	] as const) {
		await prisma.cardCycle.create({ data: { id, name, position: year } })
		await prisma.cardSet.create({
			data: {
				id,
				name,
				position: 1,
				size: 100,
				setTypeId: 'core',
				cycleId: id,
				dateRelease: new Date(`${year}-01-01`),
			},
		})
	}
	await prisma.card.create({
		data: {
			id: 'hedge_fund',
			title: 'Hedge Fund',
			strippedTitle: 'Hedge Fund',
			sideId: 'corp',
			deckLimit: 3,
			factionId: 'neutral_corp',
			typeId: 'operation',
			printings: {
				create: [
					{
						id: '01110',
						position: 110,
						quantity: 3,
						setId: 'core',
						dateRelease: new Date('2012-01-01'),
					},
					{
						id: '30075',
						position: 75,
						quantity: 3,
						setId: 'sg',
						dateRelease: new Date('2021-01-01'),
					},
				],
			},
		},
	})
	return prisma.user.create({ data: createUser(), select: { id: true } })
}

test('parseImport resolves printings by id, padded id, or name and set', async () => {
	await insertPrintings()
	const parsed = await parseImport(`Printing ID,Card,Set,Qty,Version,Notes
1110,,,2,,
,hedge fund,core set,1,,
,Hedge Fund,,4,,
,Hedge Fund,System Gateway,1,"Alt art, signed",From Worlds
,Hedge Fund,System Gateway,1,"Alt art, signed",
,Nope,,1,,
30075,,,-1,,
30075,,,0,,`)

	expect(parsed.format).toBe('csv')
	// "1110" is padded to "01110"; no set means the newest printing
	expect(Object.fromEntries(parsed.plain)).toEqual({ '01110': 3, '30075': 4 })
	expect([...parsed.variants.values()]).toEqual([
		{
			printingId: '30075',
			label: 'Alt art, signed',
			notes: 'From Worlds',
			quantity: 2,
		},
	])
	expect(parsed.errors.map((e) => e.line)).toEqual([7, 8])
})

test('parseImport accepts header aliases but rejects files without the columns it needs', async () => {
	// "name" and "count" are aliases for card and quantity (no cards exist
	// in this test, so the row itself is skipped)
	await expect(parseImport('name,count\nHedge Fund,3')).resolves.toMatchObject({
		plain: new Map(),
	})
	await expect(parseImport('foo,bar\n1,2')).rejects.toThrow(ImportFormatError)
	await expect(parseImport('{"nope": true}')).rejects.toThrow(ImportFormatError)
})

test('export → replace import round-trips, and add merges', async () => {
	const user = await insertPrintings()
	await prisma.collectionEntry.create({
		data: { userId: user.id, printingId: '30075', quantity: 2 },
	})
	await prisma.variant.create({
		data: {
			userId: user.id,
			printingId: '01110',
			label: 'Signed',
			notes: 'by the artist',
			quantity: 1,
		},
	})
	const original = await getCollectionRows(user.id)
	expect(original.map((r) => [r.printingId, r.version, r.quantity])).toEqual([
		['01110', 'Signed', 1],
		['30075', '', 2],
	])

	// add the JSON export on top: counts double, the version merges by label
	await applyImport(user.id, await parseImport(rowsToJson(original)), 'add')
	expect((await getCollectionRows(user.id)).map((r) => r.quantity)).toEqual([
		2, 4,
	])
	expect(await prisma.variant.count({ where: { userId: user.id } })).toBe(1)

	// replacing with the CSV export restores the original exactly
	await applyImport(user.id, await parseImport(rowsToCsv(original)), 'replace')
	expect(await getCollectionRows(user.id)).toEqual(original)
})
