import * as cookie from 'cookie'
import { DEFAULT_GAME, type Game, isGame } from './game.ts'

const cookieName = 'en_game'

/**
 * The game links on neutral pages (home, settings, borrowing) go to. A client
 * preference like the theme (docs/decisions/005-client-pref-cookies.md), so
 * it needs no account and the server renders the right links.
 */
export function getPreferredGame(request: Request): Game {
	const cookieHeader = request.headers.get('cookie')
	const value = cookieHeader
		? cookie.parseCookie(cookieHeader)[cookieName]
		: undefined
	return isGame(value) ? value : DEFAULT_GAME
}

export function setPreferredGame(game: Game) {
	return cookie.stringifySetCookie({
		name: cookieName,
		value: game,
		path: '/',
		sameSite: 'lax',
		maxAge: 31536000,
	})
}
