// Cloudflare Pages Function: course material under /data/* is only served to enrolled students (see cloud/gate.js).
import { gate } from '../../cloud/gate.js';

export const onRequest = (ctx) => gate(ctx);
