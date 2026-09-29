import { invariantResponse } from '@epic-web/invariant'
import { Form, redirect, useLocation } from 'react-router'
import { safeRedirect } from 'remix-utils/safe-redirect'
import {
	GAME_LABELS,
	GAME_SWITCH_ACTION,
	GAMES,
	isGame,
	switchGamePath,
} from '#app/utils/game.ts'
import { setPreferredGame } from '#app/utils/game.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { useSwitchingGame } from '#app/utils/use-game.ts'
import { type Route } from './+types/game-switch.ts'

/**
 * Remembers the chosen game and goes to the same section in it: from
 * /collection/sets to /mtg/collection/sets. A page that belongs to neither
 * game (settings, borrowing) stays put, and only its links change.
 */
export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData()
	const game = formData.get('game')
	invariantResponse(isGame(game), 'Invalid game')
	const from = safeRedirect(formData.get('from'), '/')
	const { pathname } = new URL(from, 'http://localhost')
	return redirect(safeRedirect(switchGamePath(pathname, game) ?? from), {
		headers: { 'set-cookie': setPreferredGame(game) },
	})
}

/**
 * "Netrunner | MTG" next to the logo. A plain form, so it works before the page
 * has hydrated.
 */
export function GameSwitch({ className }: { className?: string }) {
	const location = useLocation()
	const game = useSwitchingGame()

	return (
		<Form
			method="POST"
			action={GAME_SWITCH_ACTION}
			className={cn(
				'bg-muted inline-flex shrink-0 gap-0.5 rounded-lg p-0.5',
				className,
			)}
			aria-label="Game"
		>
			<input
				type="hidden"
				name="from"
				value={`${location.pathname}${location.search}`}
			/>
			{GAMES.map((option) => {
				const { name, short } = GAME_LABELS[option]
				return (
					<button
						key={option}
						type="submit"
						name="game"
						value={option}
						aria-pressed={option === game}
						className={cn(
							'focus-visible:ring-ring/50 cursor-pointer rounded-md px-2 py-1 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 sm:px-3',
							option === game
								? 'bg-selected text-selected-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground',
						)}
					>
						{short === name ? (
							name
						) : (
							<>
								<span className="sm:hidden" aria-hidden>
									{short}
								</span>
								<span className="max-sm:sr-only">{name}</span>
							</>
						)}
					</button>
				)
			})}
		</Form>
	)
}
