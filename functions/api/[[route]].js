// Cloudflare Pages Function: every /api/* request (see cloud/api.js).
import { handleApi } from '../../cloud/api.js';

export const onRequest = (ctx) => handleApi(ctx);
