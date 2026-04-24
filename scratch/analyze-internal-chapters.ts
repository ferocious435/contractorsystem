import xlsx from 'xlsx';
const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

const chapters = new Set();
data.slice(1).forEach(row => {
    if (row[1] && typeof row[1] === 'string') {
        const parts = row[1].split('.');
        if (parts.length > 1) {
            chapters.add(parts[1]); // This would be the '51, 60, 42' part
        }
    }
});

console.log('Internal Chapters (Second level of 95):', Array.from(chapters).sort());
