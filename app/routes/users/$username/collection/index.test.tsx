/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { setPrintingQuantity } from '#app/utils/collection.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import {
	default as SharedSetRoute,
	loader as setLoader,
} from './sets/$setId.tsx'
import { default as SharedCollectionRoute, loader } from './index.tsx'

async function setUp() {
	await prisma.faction.create({
		data: { id: 'anarch', name: 'Anarch', sideId: 'runner' },
	})
	await prisma.cardType.create({ data: { id: 'program', name: 'Program' } })
	await prisma.cardCycle.create({
		data: { id: 'sg', name: 'System Gateway', position: 1 },
	})
	await prisma.cardSet.create({
		data: {
			id: 'sg',
			name: 'System Gateway',
			position: 1,
			size: 65,
			setTypeId: 'core',
			cycleId: 'sg',
		},
	})
	await prisma.card.create({
		data: {
			id: 'corroder',
			title: 'Corroder',
			strippedTitle: 'Corroder',
			sideId: 'runner',
			deckLimit: 3,
			legalFormats: ',standard,startup,',
			factionId: 'anarch',
			typeId: 'program',
		},
	})
	await prisma.printing.create({
		data: {
			id: '30020',
			position: 20,
			quantity: 2,
			cardId: 'corroder',
			setId: 'sg',
		},
	})

	const owner = await prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
	const viewer = await prisma.user.create({
		select: { id: true },
		data: createUser(),
	})
	await setPrintingQuantity(owner.id, '30020', 2)
	await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId: viewer.id },
	})
	const cookie = await getSessionCookieHeader(session)

	const App = createRoutesStub([
		{
			path: '/users/:username/collection',
			Component: SharedCollectionRoute,
			loader: async (args) => {
				args.request.headers.set('cookie', cookie)
				// the stub's params are untyped; the path above has these
				return loader(args as Parameters<typeof loader>[0])
			},
			HydrateFallback: () => <div>Loading...</div>,
		},
		{
			path: '/users/:username/collection/sets/:setId',
			Component: SharedSetRoute,
			loader: async (args) => {
				args.request.headers.set('cookie', cookie)
				return setLoader(args as Parameters<typeof setLoader>[0])
			},
			HydrateFallback: () => <div>Loading...</div>,
		},
	])
	return { owner, App }
}

test('a shared collection shows the owner’s counts with nothing to edit', async () => {
	const { owner, App } = await setUp()
	const basePath = `/users/${owner.username}/collection`
	const { container } = render(<App initialEntries={[basePath]} />)

	await screen.findByRole('heading', {
		level: 1,
		name: `${owner.name}’s collection`,
	})
	expect(
		screen.getByText(`Viewing ${owner.name}’s collection · read-only`),
	).toBeInTheDocument()

	// only the pages a viewer can use, under the shared path
	const nav = screen.getByRole('navigation', { name: 'Collection views' })
	expect(
		within(nav)
			.getAllByRole('link')
			.map((link) => [link.textContent, link.getAttribute('href')]),
	).toEqual([
		['Cards', basePath],
		['Sets', `${basePath}/sets`],
	])
	// the filters search this collection, not your own
	expect(container.querySelector('form')).toHaveAttribute('action', basePath)

	// in the tile's overlay and in its versions dialog
	expect(screen.getAllByText('Corroder (System Gateway):')).toHaveLength(2)
	expect(screen.getAllByText('copies')).toHaveLength(2)
	expect(screen.getAllByTitle(`${owner.name} owns 2`).length).toBeGreaterThan(0)
	expect(screen.queryByRole('button', { name: /add one/i })).toBeNull()
	expect(screen.queryByRole('button', { name: /remove one/i })).toBeNull()
	expect(screen.queryByRole('textbox', { name: /quantity/i })).toBeNull()
	expect(screen.queryByRole('button', { name: /alt art \/ other/i })).toBeNull()
	expect(screen.queryByText(/press/i)).toBeNull()

	// the tile's keyboard shortcuts have no stepper to change
	const tile = screen.getByRole('button', { name: 'Corroder: show details' })
	fireEvent.pointerEnter(tile.parentElement!)
	fireEvent.keyDown(document, { key: '+' })
	fireEvent.keyDown(document, { key: '5' })
	expect(container.querySelector('[data-quantity-stepper]')).toBeNull()
	expect(
		await prisma.collectionEntry.findFirstOrThrow({
			where: { userId: owner.id },
			select: { quantity: true },
		}),
	).toEqual({ quantity: 2 })
})

test('a shared set page has no product form', async () => {
	const { owner, App } = await setUp()
	render(
		<App initialEntries={[`/users/${owner.username}/collection/sets/sg`]} />,
	)

	await screen.findByRole('heading', { level: 1, name: 'System Gateway' })
	expect(
		screen.getByTitle(
			`${owner.name} owns 2 of this printing; 2 come in the product`,
		),
	).toBeInTheDocument()
	expect(
		screen.queryByRole('spinbutton', { name: 'Number of products' }),
	).toBeNull()
	expect(screen.queryByRole('button', { name: /add one/i })).toBeNull()
})
