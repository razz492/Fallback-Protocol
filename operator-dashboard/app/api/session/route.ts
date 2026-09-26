import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use Vercel's writable temp directory for session state persistence
const sessionFilePath = path.join(os.tmpdir(), 'session_config.json');

function readSessionFile(): { session_id: number; status: string } {
    try {
        if (fs.existsSync(sessionFilePath)) {
            const contents = fs.readFileSync(sessionFilePath, 'utf8');
            return JSON.parse(contents);
        }
    } catch { }
    // Fallback: try the project-level session_config.json
    try {
        const projectPath = path.join(os.tmpdir(), '..', 'session_config.json');
        if (fs.existsSync(projectPath)) {
            const contents = fs.readFileSync(projectPath, 'utf8');
            return JSON.parse(contents);
        }
    } catch { }
    return { session_id: 200, status: 'idle' };
}

function writeSessionFile(data: { session_id: number; status: string }): void {
    fs.writeFileSync(sessionFilePath, JSON.stringify(data));
}

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const data = readSessionFile();
        return NextResponse.json({
            session_id: data.session_id ?? 200,
            status: data.status ?? 'idle'
        });
    } catch {
        return NextResponse.json({ session_id: 200, status: 'idle' });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const currentData = readSessionFile();
        const newData = { ...currentData, ...body };
        writeSessionFile(newData);
        return NextResponse.json({ success: true, message: "State Updated" });
    } catch {
        return NextResponse.json({ success: false }, { status: 500 });
    }
}