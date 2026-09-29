import { expect, test } from 'vitest'
import { mtgImageUrl } from './mtg-images.ts'

test('builds Scryfall image URLs from the printing id', () => {
	const id = '0000419b-0bba-4488-8f7a-6194544ce91e'
	expect(mtgImageUrl(id)).toBe(
		'https://cards.scryfall.io/normal/front/0/0/0000419b-0bba-4488-8f7a-6194544ce91e.jpg',
	)
	expect(mtgImageUrl(id, 'png', 'back')).toBe(
		'https://cards.scryfall.io/png/back/0/0/0000419b-0bba-4488-8f7a-6194544ce91e.png',
	)
	expect(mtgImageUrl('ab12', 'art_crop')).toBe(
		'https://cards.scryfall.io/art_crop/front/a/b/ab12.jpg',
	)
})
