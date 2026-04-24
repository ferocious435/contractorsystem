import xlsx from 'xlsx';
const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
const wb = xlsx.readFile(excelPath);

wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const data = xlsx.utils.sheet_to_json(sheet);
    console.log(`Sheet "${name}": ${data.length} data rows (excluding header)`);
    
    // Check range
    const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
    console.log(`Range for "${name}":`, range);
    console.log(`Max Row Index: ${range.e.r}`);
});
