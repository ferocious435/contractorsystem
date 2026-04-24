import xlsx from 'xlsx';
const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

const chapters = new Set();
data.slice(1).forEach(row => {
    if (row[1] && typeof row[1] === 'string') {
        const prefix = row[1].split('.')[0];
        chapters.add(prefix);
    }
});

console.log('Chapters found in file:', Array.from(chapters));
