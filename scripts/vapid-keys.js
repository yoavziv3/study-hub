// Generates the VAPID key pair for phone notifications (Web Push) on the cloud site.
//   node scripts/vapid-keys.js
// The public key goes into wrangler.toml ([vars] VAPID_PUBLIC_KEY); the private key is a secret:
//   npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name study-hub-git
// Changing the keys later unsubscribes every device (students turn notifications on again).
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64u(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
