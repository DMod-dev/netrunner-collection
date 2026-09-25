// Mirror NetrunnerDB's card data into the local database.
// Usage: npm run sync:nrdb
import { prisma } from '#app/utils/db.server.ts'
import { runRecordedSync } from '#app/utils/nrdb.server.ts'

try {
	const summary = await runRecordedSync({ log: console.log })
	console.log('✅ NRDB sync complete', summary)
} catch (error) {
	console.error('❌ NRDB sync failed', error)
	process.exitCode = 1
} finally {
	await prisma.$disconnect()
}
