import { expect, test } from 'vitest'
import { gameFromPath, switchGamePath } from './game.ts'
import { getPreferredGame, setPreferredGame } from './game.server.ts'

test('a page belongs to the game its URL is under', () => {
	for (const path of [
		'/collection',
		'/collection/sets/sg',
		'/collection/deck-check',
		'/decks',
		'/decks/abc',
		'/decklists',
		'/users/kody/collection',
		'/users/kody/collection/sets',
	]) {
		expect({ path, game: gameFromPath(path) }).toEqual({
			path,
			game: 'netrunner',
		})
	}
	for (const path of [
		'/mtg',
		'/mtg/collection',
		'/mtg/collection/sets/',
		'/mtg/decks/new',
		'/mtg/decklists',
		'/mtg/scan',
		'/users/kody/mtg/collection',
	]) {
		expect({ path, game: gameFromPath(path) }).toEqual({ path, game: 'mtg' })
	}
	// about neither game, or about both
	for (const path of [
		'/',
		'/settings/profile',
		'/borrowing',
		'/admin/scryfall-sync',
		'/users/kody',
		'/users/kody/decks',
		'/collection/shared',
		'/collections',
		'/mtgx',
	]) {
		expect({ path, game: gameFromPath(path) }).toEqual({ path, game: null })
	}
})

test('switching game keeps the section', () => {
	const cases: Array<[string, string]> = [
		['/collection', '/mtg/collection'],
		['/collection/sets', '/mtg/collection/sets'],
		['/collection/import-export', '/mtg/collection/import-export'],
		['/decks', '/mtg/decks'],
		['/decks/new', '/mtg/decks/new'],
		['/decklists', '/mtg/decklists'],
		['/users/kody/collection', '/users/kody/mtg/collection'],
		['/users/kody/collection/sets', '/users/kody/mtg/collection/sets'],
	]
	for (const [netrunner, mtg] of cases) {
		expect([netrunner, switchGamePath(netrunner, 'mtg')]).toEqual([
			netrunner,
			mtg,
		])
		expect([mtg, switchGamePath(mtg, 'netrunner')]).toEqual([mtg, netrunner])
	}
})

test('a page the other game lacks goes to its nearest section', () => {
	// set and deck ids aren't shared between games
	expect(switchGamePath('/collection/sets/sg', 'mtg')).toBe(
		'/mtg/collection/sets',
	)
	expect(switchGamePath('/mtg/collection/sets/dmu', 'netrunner')).toBe(
		'/collection/sets',
	)
	expect(switchGamePath('/decks/abc', 'mtg')).toBe('/mtg/decks')
	// MTG has no deck check yet, and Netrunner has no scanner
	expect(switchGamePath('/collection/deck-check', 'mtg')).toBe(
		'/mtg/collection',
	)
	expect(switchGamePath('/mtg/scan', 'netrunner')).toBe('/collection')
	expect(switchGamePath('/mtg', 'netrunner')).toBe('/collection')
})

test('switching to the game a page is already in, or on a neutral page, keeps it', () => {
	expect(switchGamePath('/mtg/decks/abc', 'mtg')).toBe('/mtg/decks/abc')
	expect(switchGamePath('/settings/profile', 'mtg')).toBeNull()
	expect(switchGamePath('/collection/shared', 'netrunner')).toBeNull()
})

test('the preferred game comes from a cookie, Netrunner by default', () => {
	const request = (cookie?: string) =>
		new Request('http://localhost/', {
			headers: cookie ? { cookie } : {},
		})
	expect(getPreferredGame(request())).toBe('netrunner')
	expect(getPreferredGame(request('en_game=chess'))).toBe('netrunner')

	const setCookie = setPreferredGame('mtg')
	expect(setCookie).toMatch(/^en_game=mtg;/)
	expect(setCookie).toMatch(/Max-Age=31536000/)
	expect(getPreferredGame(request(setCookie.split(';')[0]))).toBe('mtg')
})
