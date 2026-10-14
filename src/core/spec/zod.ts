// Every spec file imports `z` from here, so the config runs before any schema is built.
import { z } from 'zod';

// No eval. Zod probes `new Function` when it builds an object schema, and Firefox reports the CSP block as an error.
z.config({ jitless: true });

export { z };
