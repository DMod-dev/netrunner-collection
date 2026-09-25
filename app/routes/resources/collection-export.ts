import { requireUserId } from '#app/utils/auth.server.ts'
import {
	getCollectionRows,
	rowsToCsv,
	rowsToJson,
} from '#app/utils/collection-io.server.ts'
import { type Route } from './+types/collection-export.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const format =
		new URL(request.url).searchParams.get('format') === 'json' ? 'json' : 'csv'
	const rows = await getCollectionRows(userId)
	const date = new Date().toISOString().slice(0, 10)
	return new Response(format === 'json' ? rowsToJson(rows) : rowsToCsv(rows), {
		headers: {
			'content-type':
				format === 'json'
					? 'application/json; charset=utf-8'
					: 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="netrunner-collection-${date}.${format}"`,
			'cache-control': 'no-store',
		},
	})
}
