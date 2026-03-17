import { NextResponse } from 'next/server';
import { getStateInstance } from '@/lib/green-api';

export async function GET() {
  try {
    const data = await getStateInstance();
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 200 }
    );
  }
}


