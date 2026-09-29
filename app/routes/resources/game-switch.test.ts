import { expect, test } from 'vitest'
import { action } from './game-switch.tsx'

async function switchGame(fields: Record<string, string>) {
	const request = new Request('http://localhost/resources/game-switch', {
		method: 'POST',
		body: new URLSearchParams(fields),
	})
	return action({
		request,
		params: {},
		context: {},
		url: new URL(request.url),
	} as Parameters<typeof action>[0]).catch((error: unknown) => error)
}

test('switching goes to the same section in the other game and remembers it', async () => {
	const response = (await switchGame({
		game: 'mtg',
		from: '/collection/sets?target=playset',
	})) as Response
	expect(response.status).toBe(302)
	// filters don't carry over between games
	expect(response.headers.get('location')).toBe('/mtg/collection/sets')
	expect(response.headers.get('set-cookie')).toMatch(/^en_game=mtg;/)

	const back = (await switchGame({
		game: 'netrunner',
		from: '/mtg/collection',
	})) as Response
	expect(back.headers.get('location')).toBe('/collection')
	expect(back.headers.get('set-cookie')).toMatch(/^en_game=netrunner;/)
})

test('a page about neither game stays put', async () => {
	const response = (await switchGame({
		game: 'mtg',
		from: '/settings/profile?tab=1',
	})) as Response
	expect(response.headers.get('location')).toBe('/settings/profile?tab=1')
	expect(response.headers.get('set-cookie')).toMatch(/^en_game=mtg;/)
})

test('only goes to pages on this site, and only for a known game', async () => {
	const offsite = (await switchGame({
		game: 'mtg',
		from: '//evil.example/collection',
	})) as Response
	expect(offsite.headers.get('location')).toBe('/')

	const unknown = await switchGame({ game: 'chess', from: '/collection' })
	expect(unknown).toBeInstanceOf(Response)
	expect((unknown as Response).status).toBe(400)
})
