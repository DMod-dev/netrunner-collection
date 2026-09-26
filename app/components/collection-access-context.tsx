import { createContext, useContext } from 'react'

/**
 * Whose collection a page shows. The Cards and Sets pages serve both your own
 * collection at /collection (editable) and one shared with you at
 * /users/:username/collection (read-only), so the components inside them read
 * this instead of taking a `readOnly` prop.
 */
export type CollectionAccessInfo = {
	canEdit: boolean
	/** Where the collection's pages live, e.g. "/users/kody/collection". */
	basePath: string
	/** The owner's display name, for "{ownerName} owns 3". */
	ownerName: string
}

// Outside a collection page (deck check, import/export) it's your own.
const CollectionAccessContext = createContext<CollectionAccessInfo>({
	canEdit: true,
	basePath: '/collection',
	ownerName: 'You',
})

export const CollectionAccessProvider = CollectionAccessContext

export function useCollectionAccess() {
	return useContext(CollectionAccessContext)
}
