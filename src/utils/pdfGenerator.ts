import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LedgerItem } from '@/components/pricing/LedgerTable';

interface PDFGeneratorProps {
    projectName: string;
    recipient: string;
    subject: string;
    legalText: string;
    items: LedgerItem[];
    vatRate?: number;
}

export const generatePricingPDF = ({
    projectName,
    recipient,
    subject,
    legalText,
    items,
    vatRate = 0.18
}: PDFGeneratorProps) => {
    // Note: Due to standard jsPDF limitations with RTL and Hebrew, 
    // a complete production setup requires importing a Hebrew-supporting .ttf font (like Arial Hebrew) 
    // into the jsPDF Virtual File System (VFS).
    // For this implementation, we use the standard setup, but text might need manual reversal or a custom font injection for perfect RTL rendering.

    // Create portrait A4 document
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    // Formatting Helpers
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(val);
    };

    // --- Header Section ---
    doc.setFontSize(22);
    // Optional: doc.addFileToVFS("hebrew-font.ttf", fontData); doc.addFont("hebrew-font.ttf", "Hebrew", "normal"); doc.setFont("Hebrew");

    // Reverse strings as a basic fallback for Hebrew (if no proper RTL font shaper is loaded)
    const reverseHebrew = (str: string) => str.split(' ').reverse().join(' '); // very basic word-level reversal fallback if needed, but we'll try straight first.

    doc.text(subject || 'הצעת מחיר חריגים', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`תאריך: ${new Date().toLocaleDateString('en-GB')}`, 20, 30);
    doc.text(`פרויקט: ${projectName || '---'}`, 20, 40);
    doc.text(`לכבוד: ${recipient || '---'}`, 20, 50);

    // --- Legal Text (AI Generated) ---
    doc.setFontSize(11);

    // Split text into lines to fit page
    const splitLegalText = doc.splitTextToSize(legalText, 170);
    let yPos = 65;

    doc.text(splitLegalText, 190, yPos, { align: 'right' }); // RTL simulation by right-aligning

    yPos += (splitLegalText.length * 6) + 10;

    // --- Financial Table ---
    const tableData = items.map((item, index) => {
        if (item.item_type === 'CHAPTER' || item.item_type === 'SUBCHAPTER') {
            return [
                '', // No Total
                '', // No Price
                '', // No Quantity
                '', // No Unit
                item.description,
                item.item_type === 'CHAPTER' ? 'פרק' : 'תת-פרק',
                ''
            ];
        }
        
        if (item.item_type === 'NOTE') {
            return [
                '',
                '',
                '',
                '',
                `ⓘ ${item.description}`,
                'הערה',
                ''
            ];
        }

        return [
            formatCurrency(item.quantity * item.unit_price_excl_vat),
            formatCurrency(item.unit_price_excl_vat),
            item.quantity.toString(),
            item.unit,
            item.description,
            item.item_code || '-',
            (index + 1).toString()
        ];
    });

    autoTable(doc, {
        startY: yPos,
        head: [['סה"כ', 'מחיר יחידה', 'כמות', 'יח"מ', 'תיאור', 'קוד סעיף', '#']],
        body: tableData,
        theme: 'grid',
        styles: {
            halign: 'right',
            font: 'helvetica', // Будет заменено на Rubik при наличии шрифта
        },
        headStyles: {
            fillColor: [21, 28, 36],
            textColor: 255,
            halign: 'right'
        },
        columnStyles: {
            0: { halign: 'left' }, // Sums
            1: { halign: 'left' }, // Price
            2: { halign: 'center' }, // Quantity
        },
        alternateRowStyles: {
            fillColor: [240, 240, 240]
        },
        // Важно для иврита:
        margin: { right: 10, left: 10 },
        tableWidth: 'auto',
        didParseCell: (data) => {
            const rowIndex = data.row.index;
            const item = items[rowIndex];
            
            if (item?.item_type === 'CHAPTER') {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = [220, 220, 220];
            } else if (item?.item_type === 'SUBCHAPTER') {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.textColor = [59, 130, 246];
            } else if (item?.item_type === 'NOTE') {
                data.cell.styles.fontStyle = 'italic';
                data.cell.styles.textColor = [100, 100, 100];
            }
        }
    });

    // --- Footer Summary ---
    const finalY = (doc as any).lastAutoTable.finalY + 15;

    // Filter only ITEM types for calculations
    const calculationItems = items.filter(i => !i.item_type || i.item_type === 'ITEM');
    const totalExclVat = calculationItems.reduce((sum, i) => sum + (i.quantity * i.unit_price_excl_vat), 0);
    const totalVat = totalExclVat * vatRate;
    const totalInclVat = totalExclVat + totalVat;

    doc.setFontSize(12);
    doc.text(`סה"כ ביניים (ללא מע"מ): ${formatCurrency(totalExclVat)}`, 190, finalY, { align: 'right' });
    doc.text(`מע"מ (${(vatRate * 100).toFixed(0)}%): ${formatCurrency(totalVat)}`, 190, finalY + 8, { align: 'right' });

    doc.setFontSize(14);
    doc.text(`סה"כ לתשלום: ${formatCurrency(totalInclVat)}`, 190, finalY + 18, { align: 'right' });

    // Save PDF
    doc.save(`VO_Letter_${new Date().getTime()}.pdf`);
};
