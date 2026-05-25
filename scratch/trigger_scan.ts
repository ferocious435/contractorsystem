// @ts-nocheck
import fetch from "node-fetch";

async function main() {
    const projectId = "d7362181-c47b-46b5-b0c8-3e53bf9058eb";
    const port = 3000; // Пробуем 3000
    
    console.log(`Triggering scan for project ${projectId} on port ${port}...`);
    
    try {
        const response = await fetch(`http://localhost:${port}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                projectId, 
                force: true
            })
        });

        const data = await response.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (err: any) {
        console.error("Scan error:", err.message);
    }
}

main();
