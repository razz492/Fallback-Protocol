import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
export const dynamic = 'force-dynamic';
export async function GET() {
    try {
        // Go up one directory from the Next.js project to find the Python JSON file
        // e.g., /home/amr01/fallback_protocol/session_config.json
        const filePath = path.join(process.cwd(), '..', 'session_config.json');
        
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContents);
        
        return NextResponse.json({ session_id: data.session_id });
    } catch (error) {
        console.error("Could not read session config:", error);
        // Fallback to 200 if the file doesn't exist yet
        return NextResponse.json({ session_id: 200 }); 
    }
}