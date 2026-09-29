// Mirror Scryfall's MTG card data into the local database.
// Usage: npm run sync:scryfall [-- --force]
// Without --force, nothing is downloaded if Scryfall's bulk file hasn't
// changed since the last successful import.
import { prisma } from '#app/utils/db.server.ts'
import { runRecordedMtgSync } from '#app/utils/scryfall.server.ts'

try {
	const summary = await runRecordedMtgSync({
		log: console.log,
		trigger: 'cli',
		force: process.argv.includes('--force'),
	})
	console.log('✅ Scryfall sync complete', summary)
} catch (error) {
	console.error('❌ Scryfall sync failed', error)
	process.exitCode = 1
} finally {
	await prisma.$disconnect()
}
