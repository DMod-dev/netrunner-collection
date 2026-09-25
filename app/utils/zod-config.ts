import { z } from 'zod'

// Zod 4 probes `new Function` to JIT-compile object parsers. Our CSP blocks
// eval, and browsers report even the caught probe as a violation. Zod reads
// this flag when each schema is built, so root.tsx imports this module first,
// and package.json lists it under `sideEffects` so the bundler keeps it.
z.config({ jitless: true })
