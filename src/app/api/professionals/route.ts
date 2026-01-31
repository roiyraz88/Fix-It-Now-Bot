import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Professional from '@/models/Professional';

export async function GET() {
  await dbConnect();
  const professionals = await Professional.find({});
  return NextResponse.json(professionals);
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    
    // Check if phone already exists
    const existing = await Professional.findOne({ phone: body.phone });
    if (existing) {
      return NextResponse.json({ error: 'מספר טלפון זה כבר קיים במערכת' }, { status: 400 });
    }

    const professional = await Professional.create(body);
    return NextResponse.json(professional);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    await Professional.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

