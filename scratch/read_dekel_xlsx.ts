import * as XLSX from 'xlsx';
import * as fs from 'fs';

const filePath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';

function readExcelHeaders() {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert first 5 rows to JSON to see the structure
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }).slice(0, 5);
    
    fs.writeFileSync('scratch/dekel_head_utf8.json', JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error("Error reading file:", error);
  }
}

readExcelHeaders();
