/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createDeck, setDeckCardQuantity } from '#app/utils/deck.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertCards } from '#tests/deck-db.ts'
import { default as DecklistsRoute, loader } from './index.tsx'

function renderDecklists(path: string) {
	const App = createRoutesStub([
		{
			path: '/decklists',
			Component: DecklistsRoute,
			// signed out: no cookie
			loader: (args) => loader(args as Parameters<typeof loader>[0]),
			HydrateFallback: () => <div>Loading...</div>,
		},
	])
	return render(<App initialEntries={[path]} />)
}

test('anyone can search the public decks', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await prisma.user.create({
		data: { ...createUser(), username: 'glacier_fan', name: 'Gia' },
		select: { id: true },
	})
	const glacier = await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
		name: 'Glacier',
	})
	await setDeckCardQuantity(owner.id, glacier!.id, 'hedge_fund', 3)
	await createDeck(owner.id, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
		name: 'Breakers',
	})
	const secret = await createDeck(owner.id, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
		name: 'Secret',
	})
	await prisma.deck.update({
		where: { id: secret!.id },
		data: { isPublic: false },
	})
	renderDecklists('/decklists')

	await screen.findByText('2 decks')
	const results = () =>
		screen
			.queryAllByRole('link')
			.filter((a) => a.getAttribute('href')?.startsWith('/decks/'))
	expect(
		results().map((a) => within(a).getByRole('heading').textContent),
	).toEqual(expect.arrayContaining(['Glacier', 'Breakers']))
	const glacierLink = results().find((a) => a.textContent?.includes('Glacier'))!
	expect(glacierLink).toHaveAttribute('href', `/decks/${glacier!.id}`)
	expect(within(glacierLink).getByText('by Gia')).toBeInTheDocument()
	expect(
		within(glacierLink).getByText('Standard · 3 / 45 cards'),
	).toBeInTheDocument()

	// a card in the deck finds it
	await user.type(
		screen.getByRole('searchbox', { name: 'Search decks' }),
		'hedge{Enter}',
	)
	await screen.findByText('1 deck')
	expect(results()).toHaveLength(1)

	await user.click(screen.getByRole('link', { name: 'Clear search' }))
	await screen.findByText('2 decks')
	expect(screen.getByRole('searchbox', { name: 'Search decks' })).toHaveValue(
		'',
	)

	await user.selectOptions(screen.getByLabelText('Side'), 'runner')
	await screen.findByText('1 deck')
	expect(results()[0]).toHaveTextContent('Breakers')
})

test('an author link lists that player’s decks until cleared', async () => {
	const user = userEvent.setup()
	await insertCards()
	for (const username of ['alice_runs', 'bob_brews']) {
		const owner = await prisma.user.create({
			data: { ...createUser(), username },
			select: { id: true },
		})
		await createDeck(owner.id, {
			identityCardId: 'the_catalyst',
			formatId: 'standard',
			name: `${username} deck`,
		})
	}
	renderDecklists('/decklists?author=alice_runs')

	expect(await screen.findByRole('status')).toHaveTextContent(
		'1 deck by alice_runs',
	)
	await user.click(screen.getByRole('link', { name: 'Any player' }))
	await screen.findByText('2 decks')
})

test('picking a side leaves only its factions, and drops one from the other side', async () => {
	const user = userEvent.setup()
	await insertCards()
	const owner = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await createDeck(owner.id, {
		identityCardId: 'precision_design',
		formatId: 'standard',
		name: 'Glacier',
	})
	await createDeck(owner.id, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
		name: 'Breakers',
	})
	renderDecklists('/decklists')
	await screen.findByText('2 decks')

	const faction = screen.getByLabelText('Faction')
	const options = () =>
		within(faction)
			.getAllByRole('option')
			.map((o) => o.textContent)
	expect(options()).toEqual(['Any faction', 'Haas-Bioroid', 'Anarch'])

	await user.selectOptions(faction, 'haas_bioroid')
	await screen.findByText('1 deck')
	await user.selectOptions(screen.getByLabelText('Side'), 'runner')
	expect(options()).toEqual(['Any faction', 'Anarch'])
	expect(faction).toHaveValue('')
	// the runner deck, not a runner search for an HB identity
	expect(
		await screen.findByRole('heading', { name: 'Breakers' }),
	).toBeInTheDocument()
	expect(screen.getByText('1 deck')).toBeInTheDocument()

	await user.selectOptions(screen.getByLabelText('Side'), '')
	expect(options()).toEqual(['Any faction', 'Haas-Bioroid', 'Anarch'])
})

test('a faction from the other side in the URL is ignored', async () => {
	await insertCards()
	const owner = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await createDeck(owner.id, {
		identityCardId: 'the_catalyst',
		formatId: 'standard',
		name: 'Breakers',
	})
	renderDecklists('/decklists?side=runner&faction=haas_bioroid')
	await screen.findByText('1 deck')
	expect(screen.getByLabelText('Faction')).toHaveValue('')
})
