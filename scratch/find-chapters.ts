import xlsx from 'xlsx';
const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log("Looking for CHAPTER markers (...)");
rows.forEach((row, i) => {
    const code = String(row[1] || '');
    if (code.includes('...')) {
        console.log(`Row ${i}: Code: [${code}] | Desc: ${row[2]}`);
    }
});
