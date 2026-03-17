import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getStateInstance } from '@/lib/green-api';

type GreenApiResult = {
  status: string | object;
  fullResponse?: object;
  message?: string;
  warning?: string;
};

/**
 * Full diagnostic for bot - call GET /api/health to troubleshoot "bot not responding"
 */
export async function GET() {
  const results: Record<string, unknown> = {};
  let hasError = false;

  // 1. Environment
  results.env = {
    greenApiUrl: !!process.env.GREEN_API_URL,
    greenApiId: !!process.env.GREEN_API_ID_INSTANCE,
    greenApiToken: !!process.env.GREEN_API_TOKEN_INSTANCE,
    mongodbUri: !!process.env.MONGODB_URI,
  };

  // 2. MongoDB
  try {
    await dbConnect();
    results.mongodb = { status: 'connected' };
  } catch (err) {
    results.mongodb = { status: 'error', message: (err as Error).message };
    hasError = true;
  }

  // 3. Green API / WhatsApp instance state
  try {
    const state = await getStateInstance();
    const greenApi: { status: unknown; fullResponse?: unknown; warning?: string } = {
      status: state.stateInstance || state,
      fullResponse: state,
    };
    // notAuthorized = logged out, needs QR scan
    if (state.stateInstance === 'notAuthorized') {
      hasError = true;
      greenApi.warning =
        'WhatsApp instance logged out! Scan QR code in Green API console to reconnect.';
    }
    if (state.stateInstance === 'blocked') {
      hasError = true;
      greenApi.warning = 'Instance blocked. Check Green API console.';
    }
    results.greenApi = greenApi;
  } catch (err) {
    results.greenApi = {
      status: 'error',
      message: (err as Error).message,
    };
    hasError = true;
  }

  return NextResponse.json({
    ok: !hasError,
    timestamp: new Date().toISOString(),
    ...results,
  });
}
