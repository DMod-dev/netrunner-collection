import { createContext, type ServerBuild } from 'react-router'

// Set per request in server/app.ts so routes (like the sitemap) can read the
// full route manifest.
export const serverBuildContext = createContext<ServerBuild>()
