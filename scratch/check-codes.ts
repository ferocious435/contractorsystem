import xlsx from 'xlsx';
const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log("Samples of codes for chapters/subchapters:");
rows.slice(1, 100).forEach(row => {
    const code = String(row[1] || '');
    const desc = String(row[2] || '');
    if (code.includes('.') && (code.endsWith('.') || desc.length > 50)) {
        console.log(`Code: [${code}] | Desc: ${desc.substring(0, 40)}...`);
    }
});

// Search for 95.51 specifically
console.log("\nSearching for 95.51 samples:");
rows.forEach(row => {
    const code = String(row[1] || '');
    if (code.startsWith('95.51')) {
        console.log(`Code: [${code}] | Desc: ${String(row[2]).substring(0, 40)}...`);
    }
});
