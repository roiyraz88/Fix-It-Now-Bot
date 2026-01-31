import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';

export async function GET() {
  try {
    await dbConnect();
    return NextResponse.json({ status: 'connected' });
  } catch (error) {
    return NextResponse.json({ status: 'error', message: (error as Error).message }, { status: 500 });
  }
}

