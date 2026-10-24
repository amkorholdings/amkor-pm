import { NextResponse, type NextRequest } from 'next/server';

// Agents send "Authorization: Bearer <AGENT_API_TOKEN>". Returns a 401 response if the token is wrong.
export function checkAgentToken(request: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_API_TOKEN;
  const header = request.headers.get('authorization') ?? '';
  if (!expected || header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
