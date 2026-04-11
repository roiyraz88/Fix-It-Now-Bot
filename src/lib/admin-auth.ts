import { NextResponse } from 'next/server';

/**
 * If ADMIN_SECRET is set in env, requires Authorization: Bearer <ADMIN_SECRET>.
 * If unset, allows the request (same openness as existing /api/professionals).
 */
export function requireAdmin(request: Request): NextResponse | null {
  const secret = process.env.ADMIN_SECRET?.trim();
  if (!secret) return null;
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export function adminAuthHeaders(secret: string): HeadersInit {
  const h: Record<string, string> = {};
  if (secret.trim()) h.Authorization = `Bearer ${secret.trim()}`;
  return h;
}
