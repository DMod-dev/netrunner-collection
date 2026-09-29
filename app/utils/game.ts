/**
 * The games the app tracks. Netrunner keeps its original URLs; MTG lives
 * under /mtg. Pages that aren't about one game (home, settings, borrowing,
 * Shared with me) belong to neither, and links on them follow the player's
 * preferred game, remembered in a cookie by the header's switcher.
 */
export const GAMES = ['netrunner', 'mtg'] as const
export type Game = (typeof GAMES)[number]

export const DEFAULT_GAME: Game = 'netrunner'

export const GAME_LABELS: Record<
	Game,
	{ name: string; short: string; logo: string }
> = {
	netrunner: { name: 'Netrunner', short: 'NR', logo: 'netrunner' },
	mtg: { name: 'MTG', short: 'MTG', logo: 'magic' },
}

/** Where the header's switcher posts. */
export const GAME_SWITCH_ACTION = '/resources/game-switch'

/** Where each game's sections live. */
export const GAME_ROUTES = {
	netrunner: {
		collection: '/collection',
		decks: '/decks',
		decklists: '/decklists',
		scan: null,
	},
	mtg: {
		collection: '/mtg/collection',
		decks: '/mtg/decks',
		decklists: '/mtg/decklists',
		scan: '/mtg/scan',
	},
} as const satisfies Record<Game, Record<string, string | null>>

type Section = keyof (typeof GAME_ROUTES)[Game]

/** A shared collection's pages, e.g. /users/kody/mtg/collection. */
export function userCollectionPath(game: Game, username: string) {
	return `/users/${username}${GAME_ROUTES[game].collection}`
}

export function isGame(value: unknown): value is Game {
	return GAMES.includes(value as Game)
}

// /collection/shared lists collections of both games, so it's neutral
const NEUTRAL_PATHS = ['/collection/shared']

/** The game a page belongs to, or null for a page that's about neither. */
export function gameFromPath(pathname: string): Game | null {
	return parsePath(pathname)?.game ?? null
}

/**
 * The same page in the other game, as far as it exists there: a collection's
 * Sets tab stays on Sets, a deck goes to the deck list (deck and set ids
 * aren't shared between games) and a section the other game doesn't have
 * goes to its collection. Null for a page that belongs to neither game, which
 * stays put.
 */
export function switchGamePath(pathname: string, to: Game): string | null {
	const parsed = parsePath(pathname)
	if (!parsed) return null
	if (parsed.game === to) return pathname
	const routes = GAME_ROUTES[to]
	const root = routes[parsed.section]
	if (!root) return routes.collection
	if (parsed.section === 'decks' && parsed.rest === '/new') return `${root}/new`
	if (parsed.section !== 'collection') return root
	const prefix = parsed.username ? `/users/${parsed.username}` : ''
	return `${prefix}${root}${collectionTab(parsed.rest, to, !parsed.username)}`
}

/**
 * The tabs of your own collection beyond Cards and Sets, per game. MTG gets
 * a deck check with its deck import (#63).
 */
export const COLLECTION_TABS = {
	netrunner: [
		{ path: '/deck-check', label: 'Deck check' },
		{ path: '/import-export', label: 'Import/Export' },
	],
	mtg: [{ path: '/import-export', label: 'Import/Export' }],
} satisfies Record<Game, Array<{ path: string; label: string }>>

function collectionTab(rest: string, game: Game, own: boolean) {
	if (isWithin(rest, '/sets')) return '/sets'
	if (own && COLLECTION_TABS[game].some(({ path }) => path === rest)) {
		return rest
	}
	return ''
}

function parsePath(pathname: string) {
	const path = pathname.replace(/\/+$/, '') || '/'
	if (NEUTRAL_PATHS.some((neutral) => isWithin(path, neutral))) return null
	let username: string | null = null
	let rest = path
	const shared = /^\/users\/([^/]+)(\/.*)$/.exec(path)
	if (shared) {
		username = shared[1]!
		rest = shared[2]!
	}
	// /mtg on its own is MTG's home, which is its collection
	if (rest === '/mtg' && !username) {
		return {
			game: 'mtg' as const,
			section: 'collection' as const,
			username,
			rest: '',
		}
	}
	for (const game of GAMES) {
		for (const [section, root] of Object.entries(GAME_ROUTES[game])) {
			if (!root || !isWithin(rest, root)) continue
			// only the collection is shared under /users/:username
			if (username && section !== 'collection') continue
			return {
				game,
				section: section as Section,
				username,
				rest: rest.slice(root.length),
			}
		}
	}
	return null
}

function isWithin(path: string, root: string) {
	return path === root || path.startsWith(`${root}/`)
}
