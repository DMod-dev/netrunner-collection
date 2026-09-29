import { useLocation } from 'react-router'
import { DEFAULT_GAME, type Game, gameFromPath } from './game.ts'
import { useOptionalRequestInfo } from './request-info.ts'

/**
 * The game the current page is about, or the preferred game on a page that's
 * about neither.
 */
export function useCurrentGame(): Game {
	const { pathname } = useLocation()
	const requestInfo = useOptionalRequestInfo()
	return gameFromPath(pathname) ?? requestInfo?.userPrefs.game ?? DEFAULT_GAME
}
