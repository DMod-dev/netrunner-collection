import { expect, test } from 'vitest'
import { pickArtPrinting } from './collection.ts'

const printing = (id: string, plain = 0, variants: number[] = []) => ({
	id,
	collectionEntries: plain ? [{ quantity: plain }] : [],
	variants: variants.map((quantity) => ({ quantity })),
})

test('pickArtPrinting prefers the chosen art, then owned art, then the newest', () => {
	const newest = printing('new')
	const ownedPlain = printing('mid', 1)
	const ownedVariant = printing('old', 0, [1])

	expect(pickArtPrinting([newest, printing('old')])).toBe(newest)
	expect(pickArtPrinting([newest, ownedPlain, ownedVariant])).toBe(ownedPlain)
	expect(pickArtPrinting([newest, printing('mid', 0, [0]), ownedVariant])).toBe(
		ownedVariant,
	)
	expect(pickArtPrinting([newest, ownedPlain], 'new')).toBe(newest)
	// a choice that no longer exists falls back
	expect(pickArtPrinting([newest, ownedPlain], 'gone')).toBe(ownedPlain)
	expect(pickArtPrinting([])).toBeUndefined()
})
