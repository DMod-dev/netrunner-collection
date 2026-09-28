import { getUserId } from '#app/utils/auth.server.ts'
import { deckFileName, toNrdbText } from '#app/utils/deck-export.ts'
import { evaluateDeck } from '#app/utils/deck-rules.ts'
import { getDeckForBuilder } from '#app/utils/deck.server.ts'
import { type Route } from './+types/deck-export.ts'

/** `?deckId=`: the deck as a text file, like NetrunnerDB's text export. */
export async function loader({ request }: Route.LoaderArgs) {
	const userId = await getUserId(request)
	const deckId = new URL(request.url).searchParams.get('deckId') ?? ''
	// anyone can download a public deck; someone else's private deck is a 404,
	// as in the builder
	const deck = await getDeckForBuilder(userId, deckId)
	const text = toNrdbText(
		deck,
		evaluateDeck({
			identity: deck.identity,
			cards: deck.cards,
			formatId: deck.formatId,
			requireLegality: deck.requireLegality,
			rules: deck.rules,
		}),
	)
	const fileName = deckFileName(deck.name)
	// the name as it is, for browsers that take a UTF-8 file name
	const fullName = `${deck.name.replace(/\p{Cc}+/gu, '').replace(/[\\/:*?"<>|]+/g, '-')}.txt`
	return new Response(text, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fullName)}`,
			'cache-control': 'no-store',
		},
	})
}
