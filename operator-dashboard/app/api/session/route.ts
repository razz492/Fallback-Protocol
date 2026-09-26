import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), '..', 'session_config.json');
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContents);
        
        // FIX: Used ?? instead of || so session_id 0 doesn't accidentally become 200
        return NextResponse.json({ 
            session_id: data.session_id ?? 200,
            status: data.status ?? 'idle' 
        });
    } catch (error) {
        return NextResponse.json({ session_id: 200, status: 'idle' }); 
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const filePath = path.join(process.cwd(), '..', 'session_config.json');
        
        let currentData = { session_id: 200, status: 'idle' };
        if (fs.existsSync(filePath)) {
            try {
                currentData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (e) { }
        }
        
        const newData = { ...currentData, ...body };
        fs.writeFileSync(filePath, JSON.stringify(newData));
        
        return NextResponse.json({ success: true, message: "State Updated" });
    } catch (error) {
        return NextResponse.json({ success: false }, { status: 500 });
    }
}