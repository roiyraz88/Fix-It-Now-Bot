import { NextResponse } from 'next/server';
import { getStateInstance } from '@/lib/green-api';

export async function GET() {
  try {
    const data = await getStateInstance();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}


