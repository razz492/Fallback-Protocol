import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Save the signal in the system's temp folder to avoid Next.js hot-reloads
const filePath = path.join(os.tmpdir(), 'robot_signal.json');

export async function GET() {
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return NextResponse.json(data);
        }
        return NextResponse.json({ ready: false });
    } catch (e) {
        return NextResponse.json({ ready: false });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        fs.writeFileSync(filePath, JSON.stringify(body));
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ success: false });
    }
}