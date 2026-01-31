import { NextResponse } from 'next/server';
import { setSettings } from '@/lib/green-api';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const result = await setSettings({
      webhookUrl: url,
      incomingWebhook: 'yes',
      stateWebhook: 'yes',
      outgoingWebhook: 'no'
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

