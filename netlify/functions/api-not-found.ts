import type { Context } from '@netlify/functions';
import { errorResponse } from './_lib/helpers.js';

export default async function handler(_request: Request, _context: Context) {
  void _request;
  void _context;
  return errorResponse('Not found', 404);
}
