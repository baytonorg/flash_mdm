import type { Context } from '@netlify/functions';
import { getPlatformSettings } from './_lib/platform-settings.js';
import { errorResponse, jsonResponse } from './_lib/helpers.js';

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const settings = await getPlatformSettings();
    return jsonResponse({
      invite_only_registration: settings.invite_only_registration,
    });
  } catch (err) {
    console.error('Auth config error:', err);
    return jsonResponse({
      invite_only_registration: false,
      fallback: true,
    });
  }
}
