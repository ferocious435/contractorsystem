import xlsx from 'xlsx';
import * as fs from 'fs';

const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
if (!fs.existsSync(excelPath)) {
    console.error('File not found');
    process.exit(1);
}

const wb = xlsx.readFile(excelPath);
console.log('Total Sheets:', wb.SheetNames.length);
console.log('Sheet Names:', wb.SheetNames);

wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
    const rows = range.e.r - range.s.r + 1;
    console.log(`Sheet "${name}" has ~${rows} rows`);
});
