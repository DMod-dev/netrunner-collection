import { useLocation, useNavigation } from 'react-router'
import {
	DEFAULT_GAME,
	type Game,
	GAME_SWITCH_ACTION,
	gameFromPath,
	isGame,
} from './game.ts'
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

/**
 * The current game, or the one being switched to while the switch is on its
 * way, so the switcher and the logo change as soon as it's clicked.
 */
export function useSwitchingGame(): Game {
	const currentGame = useCurrentGame()
	const navigation = useNavigation()
	const pendingGame =
		navigation.formAction === GAME_SWITCH_ACTION
			? navigation.formData?.get('game')
			: undefined
	return isGame(pendingGame) ? pendingGame : currentGame
}
