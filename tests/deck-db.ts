import { prisma } from '#app/utils/db.server.ts'

/** A few real-ish cards on both sides, with a printing each for the art. */
export async function insertCards() {
	await prisma.faction.createMany({
		data: [
			{ id: 'haas_bioroid', name: 'Haas-Bioroid', sideId: 'corp' },
			{ id: 'anarch', name: 'Anarch', sideId: 'runner' },
		],
	})
	await prisma.cardType.createMany({
		data: [
			{ id: 'corp_identity', name: 'Identity' },
			{ id: 'runner_identity', name: 'Identity' },
			{ id: 'operation', name: 'Operation' },
			{ id: 'program', name: 'Program' },
		],
	})
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
	const cards = [
		{
			id: 'precision_design',
			title: 'Haas-Bioroid: Precision Design',
			sideId: 'corp',
			factionId: 'haas_bioroid',
			typeId: 'corp_identity',
			minimumDeckSize: 45,
			influenceLimit: 15,
		},
		{
			id: 'hedge_fund',
			title: 'Hedge Fund',
			sideId: 'corp',
			factionId: 'haas_bioroid',
			typeId: 'operation',
			influenceCost: 0,
		},
		{
			id: 'the_catalyst',
			title: 'The Catalyst: Convention Breaker',
			sideId: 'runner',
			factionId: 'anarch',
			typeId: 'runner_identity',
			minimumDeckSize: 40,
			influenceLimit: 15,
		},
		{
			id: 'corroder',
			title: 'Corroder',
			sideId: 'runner',
			factionId: 'anarch',
			typeId: 'program',
			influenceCost: 1,
		},
	]
	for (const [i, card] of cards.entries()) {
		await prisma.card.create({
			data: {
				...card,
				strippedTitle: card.title,
				deckLimit: card.typeId.endsWith('identity') ? 1 : 3,
				legalFormats: ',standard,',
				printings: {
					create: {
						id: String(30000 + i),
						position: i,
						quantity: 1,
						setId: 'sg',
						isLatest: true,
						imageSmall: `https://img/${card.id}.jpg`,
					},
				},
			},
		})
	}
}
