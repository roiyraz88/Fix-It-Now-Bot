import { NextResponse } from 'next/server';
import { sendMessage } from '@/lib/green-api';

export async function POST(request: Request) {
  try {
    const { phoneNumber, message } = await request.json();
    const data = await sendMessage(phoneNumber, message);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}


