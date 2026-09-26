import { expect, test } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { getSessionExpirationDate } from './auth.server.ts'
import {
	loadCardsPage,
	loadSetPage,
	loadSetsPage,
	requireCollectionView,
} from './collection-loaders.server.ts'
import { createVariant, setPrintingQuantity } from './collection.server.ts'
import { prisma } from './db.server.ts'

async function insertUser() {
	return prisma.user.create({
		select: { id: true, username: true, name: true },
		data: createUser(),
	})
}

async function signedInRequest(userId: string, path: string) {
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId },
	})
	return new Request(`http://localhost${path}`, {
		headers: { cookie: await getSessionCookieHeader(session) },
	})
}

async function insertPrinting() {
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
	return prisma.printing.create({
		data: {
			id: '30020',
			position: 20,
			quantity: 2,
			cardId: 'corroder',
			setId: 'sg',
		},
	})
}

/** An owner with 2 plain copies and a noted promo, shared with a viewer. */
async function sharedCollection() {
	const printing = await insertPrinting()
	const owner = await insertUser()
	const viewer = await insertUser()
	await setPrintingQuantity(owner.id, printing.id, 2)
	await createVariant(owner.id, {
		printingId: printing.id,
		label: 'Worlds promo',
		notes: 'signed by the artist',
	})
	await prisma.collectionShare.create({
		data: { ownerId: owner.id, viewerId: viewer.id },
	})
	return { printing, owner, viewer }
}

test('your own collection lives at /collection and is editable', async () => {
	const me = await insertUser()
	const request = await signedInRequest(me.id, '/collection')

	expect(await requireCollectionView(request)).toEqual({
		ownerId: me.id,
		canEdit: true,
		basePath: '/collection',
		ownerName: 'You',
	})
})

test('a shared collection is read-only and never includes version notes', async () => {
	const { owner, viewer } = await sharedCollection()
	const path = `/users/${owner.username}/collection`
	const view = await requireCollectionView(
		await signedInRequest(viewer.id, path),
		owner.username,
	)
	expect(view).toEqual({
		ownerId: owner.id,
		canEdit: false,
		basePath: path,
		ownerName: owner.name,
	})

	const cards = await loadCardsPage(
		await signedInRequest(viewer.id, path),
		view,
	)
	expect(cards.access).toEqual({
		canEdit: false,
		basePath: path,
		ownerName: owner.name,
	})
	expect(cards.totals.copies).toBe(3)
	const [printing] = cards.cards[0]!.printings
	expect(printing!.collectionEntries).toEqual([{ quantity: 2 }])
	expect(printing!.variants).toEqual([
		{ id: expect.any(String), label: 'Worlds promo', quantity: 1 },
	])

	const set = await loadSetPage(
		await signedInRequest(viewer.id, `${path}/sets/sg`),
		view,
		'sg',
	)
	expect(set.set.have).toBe(2)
	expect(set.set.printings[0]!.variants[0]).not.toHaveProperty('notes')
	expect(JSON.stringify([cards, set])).not.toContain('signed by the artist')

	const sets = await loadSetsPage(
		await signedInRequest(viewer.id, `${path}/sets?target=playset`),
		view,
	)
	expect(sets.target).toBe('playset')
	expect(sets.cycles[0]!.sets[0]).toMatchObject({ have: 3, need: 3 })
})

test('the owner still sees their own notes', async () => {
	const { owner } = await sharedCollection()
	const request = await signedInRequest(owner.id, '/collection')

	const cards = await loadCardsPage(
		request,
		await requireCollectionView(request),
	)
	expect(cards.cards[0]!.printings[0]!.variants[0]).toMatchObject({
		notes: 'signed by the artist',
	})
})

test('the owner visiting their own shared URL is sent to /collection', async () => {
	const me = await insertUser()
	const request = await signedInRequest(
		me.id,
		`/users/${me.username}/collection/sets/sg?target=playset`,
	)

	const thrown = await requireCollectionView(request, me.username).catch(
		(error: unknown) => error,
	)
	expect(thrown).toBeInstanceOf(Response)
	expect((thrown as Response).status).toBe(302)
	expect((thrown as Response).headers.get('location')).toBe(
		'/collection/sets/sg?target=playset',
	)
})

test('without a share the collection is a 404', async () => {
	const { owner } = await sharedCollection()
	const stranger = await insertUser()
	const request = await signedInRequest(
		stranger.id,
		`/users/${owner.username}/collection`,
	)

	const thrown = await requireCollectionView(request, owner.username).catch(
		(error: unknown) => error,
	)
	expect(thrown).toBeInstanceOf(Response)
	expect((thrown as Response).status).toBe(404)
})
