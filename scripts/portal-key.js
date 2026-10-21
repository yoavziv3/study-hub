// Prints the Mac's public key for students' portal sign-ins (creating the key pair on first run), as the value of
// PORTAL_PUBLIC_KEY in wrangler.toml. The private half stays in portal-key.json on this Mac.
//   node scripts/portal-key.js
import { portalKey } from '../server/lib/portal-relay.js';

const { publicJwk } = await portalKey();
console.log(JSON.stringify({ kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e, alg: publicJwk.alg }));
