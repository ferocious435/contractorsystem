import xlsx from 'xlsx';
const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log("Checking for potential chapter headers for 51, 60, 42:");
const targets = ['95.51', '95.60', '95.42'];
rows.forEach((row, i) => {
    const code = String(row[1] || '');
    if (targets.some(t => code === t || code === t + '.' || code === t + '..' || code === t + '...')) {
        console.log(`Row ${i}: Code: [${code}] | Desc: ${row[2]}`);
    }
});
