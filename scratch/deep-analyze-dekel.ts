import xlsx from 'xlsx';
const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

const chapterStats: Record<string, number> = {};
data.slice(1).forEach(row => {
    if (row[1] && typeof row[1] === 'string') {
        const prefix = row[1].split('.')[0];
        chapterStats[prefix] = (chapterStats[prefix] || 0) + 1;
    }
});

console.log('Chapter Distribution:', chapterStats);
console.log('Total rows processed:', data.length - 1);

// Find where other chapters start if they exist
const otherChapters = data.filter((row, idx) => {
    if (row[1] && typeof row[1] === 'string') {
        return !row[1].startsWith('95');
    }
    return false;
});

console.log('Rows that DO NOT start with 95:', otherChapters.length);
if (otherChapters.length > 0) {
    console.log('Sample of other chapters:', otherChapters.slice(0, 5));
}
