import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { prisma } from './db.server.ts'
import { parseDeckText } from './deck-check.server.ts'
import { deckFileName, toNrdbText } from './deck-export.ts'
import { importDeck } from './deck-import.server.ts'
import { evaluateDeck } from './deck-rules.ts'
import { getDeckForBuilder } from './deck.server.ts'

const card = (id: string, title: string, typeId: string, typeName: string) => ({
	id,
	title,
	typeId,
	typeName,
})

test('toNrdbText writes sections by type, influence dots and the stats', () => {
	const text = toNrdbText(
		{
			name: 'Loup Aggro',
			sideId: 'runner',
			identity: { title: 'René "Loup" Arcemont: Party Animal' },
			cards: [
				{ card: card('mayday', 'Mayday', 'hardware', 'Hardware'), quantity: 1 },
				{
					card: card('wildcat', 'Wildcat Strike', 'event', 'Event'),
					quantity: 3,
				},
				{
					card: card('carnivore', 'Carnivore', 'program', 'Program'),
					quantity: 2,
				},
				{ card: card('diesel', 'Diesel', 'event', 'Event'), quantity: 3 },
			],
		},
		{
			stats: {
				cardCount: 9,
				minDeckSize: 40,
				influenceSpent: 4,
				influenceLimit: 15,
				agendaPoints: null,
				agendaMin: null,
				agendaMax: null,
				points: null,
				pointLimit: null,
			},
			perCard: {
				carnivore: { influence: 4, problems: [] },
				wildcat: { influence: 0, problems: [] },
			},
		},
	)
	expect(text).toBe(`Loup Aggro
René "Loup" Arcemont: Party Animal

Event (6)
3x Diesel
3x Wildcat Strike

Hardware (1)
1x Mayday

Program (2)
2x Carnivore ●●●●

9 cards (min 40)
4 influence spent (max 15)
`)
})

test('toNrdbText adds agenda and format points when the deck has them', () => {
	const text = toNrdbText(
		{ name: 'Glacier', sideId: 'corp', identity: null, cards: [] },
		{
			stats: {
				cardCount: 1,
				minDeckSize: null,
				influenceSpent: 0,
				influenceLimit: null,
				agendaPoints: 0,
				agendaMin: 2,
				agendaMax: 3,
				points: 3,
				pointLimit: 7,
			},
			perCard: {},
		},
	)
	expect(text.split('\n').slice(-5)).toEqual([
		'1 card',
		'0 influence spent',
		'0 agenda points (between 2 and 3)',
		'3 format points (max 7)',
		'',
	])
})

test('deckFileName keeps a name a file system takes', () => {
	expect(deckFileName('René’s  "Loup" / deck')).toBe('Renes-Loup-deck.txt')
	expect(deckFileName('???')).toBe('deck.txt')
})

test('an exported deck imports as the same deck', async () => {
	await insertCards()
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	// named after its identity, as a new deck is by default
	const { deckId } = await importDeck(
		user.id,
		'The Catalyst: Convention Breaker\n3x Corroder\n2x Hedge Fund',
		{ formatId: 'standard', requireLegality: true },
	)

	const exported = async (id: string) => {
		const deck = await getDeckForBuilder(user.id, id)
		return toNrdbText(deck, evaluateDeck(deck))
	}
	const text = await exported(deckId)
	expect(text).toContain('Program (3)\n3x Corroder\n')

	const parsed = await parseDeckText(text)
	expect(parsed.unrecognized).toEqual([])
	const again = await importDeck(user.id, text, {
		formatId: 'standard',
		requireLegality: true,
	})
	const rows = (id: string) =>
		prisma.deck.findUniqueOrThrow({
			where: { id },
			select: {
				name: true,
				identityCardId: true,
				cards: {
					orderBy: { cardId: 'asc' },
					select: { cardId: true, quantity: true },
				},
			},
		})
	expect(await rows(again.deckId)).toEqual(await rows(deckId))
	expect(await exported(again.deckId)).toBe(text)
})
