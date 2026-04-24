import xlsx from 'xlsx';
import * as fs from 'fs';

const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log('Total rows found:', data.length);
console.log('Header Row:', data[0]);
console.log('Sample Data (Rows 1-5):');
data.slice(1, 6).forEach((row, i) => console.log(`Row ${i+1}:`, row));
