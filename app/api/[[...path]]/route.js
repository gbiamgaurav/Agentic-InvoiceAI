import { NextResponse } from 'next/server'

// Frontend-only MVP. Backend will be implemented in Python later.
export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Frontend-only MVP. Python backend pending.' })
}

export async function POST() {
  return NextResponse.json({ status: 'ok', message: 'Frontend-only MVP. Python backend pending.' })
}
