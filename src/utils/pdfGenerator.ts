import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LedgerItem } from '@/components/pricing/LedgerTable';
import { HEBREW_FONT_BASE64 } from './fonts/hebrewFont';
import { VAT_RATE, AI_MODEL_BRANDING } from './constants';

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
    vatRate = VAT_RATE
}: PDFGeneratorProps) => {
    // Create portrait A4 document
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    // Add Hebrew Font support
    doc.addFileToVFS('Rubik-Regular.ttf', HEBREW_FONT_BASE64);
    doc.addFont('Rubik-Regular.ttf', 'Rubik', 'normal');
    doc.setFont('Rubik');

    // Formatting Helpers
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(val);
    };

    // --- Header Section ---
    doc.setFontSize(22);
    
    doc.text(subject || 'הצעת מחיר חריגים', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`תאריך: ${new Date().toLocaleDateString('he-IL')}`, 20, 30);
    doc.text(`פרויקט: ${projectName || '---'}`, 190, 40, { align: 'right' });
    doc.text(`לכבוד: ${recipient || '---'}`, 190, 50, { align: 'right' });

    // --- Legal Text (AI Generated) ---
    doc.setFontSize(11);

    // Split text into lines to fit page
    const splitLegalText = doc.splitTextToSize(legalText, 170);
    let yPos = 65;

    doc.text(splitLegalText, 190, yPos, { align: 'right' }); 


    yPos += (splitLegalText.length * 6) + 10;

    // --- Financial Table ---
    const tableData: any[] = [];
    
    items.forEach((item, index) => {
        if (item.item_type === 'CHAPTER' || item.item_type === 'SUBCHAPTER') {
            tableData.push([
                '', // No Total
                '', // No Price
                '', // No Quantity
                '', // No Unit
                item.description,
                item.item_code || (item.item_type === 'CHAPTER' ? 'פרק' : 'תת-פרק'),
                ''
            ]);
            return;
        }
        
        if (item.item_type === 'NOTE') {
            tableData.push([
                '',
                '',
                '',
                '',
                `ⓘ ${item.description}`,
                'הערה',
                ''
            ]);
            return;
        }

        // Standard Item
        tableData.push([
            formatCurrency(item.quantity * item.unit_price_excl_vat),
            formatCurrency(item.unit_price_excl_vat),
            item.quantity.toString(),
            item.unit,
            item.description,
            item.item_code || '-',
            (index + 1).toString()
        ]);

        // Add AI Rationale row if exists
        if (item.ai_rationale) {
            tableData.push([
                { 
                    content: `הסבר מקצועי (AI): ${item.ai_rationale}`, 
                    colSpan: 5, 
                    styles: { 
                        fontSize: 8, 
                        fontStyle: 'italic', 
                        textColor: [100, 116, 139],
                        cellPadding: { top: 1, bottom: 2, left: 2, right: 5 }
                    } 
                },
                '', '' // Placeholders for remaining columns if needed, though colSpan handles it
            ]);
        }

        // Add Governing Notes (Evidence) if exists
        if (item.governing_notes) {
            let noteText = '';
            if (typeof item.governing_notes === 'string') {
                noteText = item.governing_notes;
            } else if (Array.isArray(item.governing_notes)) {
                noteText = item.governing_notes.map((n: any) => n.text || JSON.stringify(n)).join(' | ');
            } else if (typeof item.governing_notes === 'object') {
                noteText = item.governing_notes.instruction || item.governing_notes.note || JSON.stringify(item.governing_notes);
            }

            if (noteText) {
                tableData.push([
                    { 
                        content: `סימוכין חוזי: ${noteText}`, 
                        colSpan: 5, 
                        styles: { 
                            fontSize: 8, 
                            fontStyle: 'bold', 
                            textColor: [16, 185, 129],
                            cellPadding: { top: 1, bottom: 2, left: 2, right: 5 }
                        } 
                    },
                    '', ''
                ]);
            }
        }
    });

    autoTable(doc, {
        startY: yPos,
        head: [['סה"כ', 'מחיר יחידה', 'כמות', 'יח"מ', 'תיאור', 'קוד סעיף', '#']],
        body: tableData,
        theme: 'grid',
        styles: {
            font: 'Rubik',
            halign: 'right',
        },
        headStyles: {
            fillColor: [21, 28, 36],
            textColor: 255,
            halign: 'right',
            font: 'Rubik'
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

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setTextColor(150, 150, 150);
        doc.setFontSize(8);
        doc.text(`${AI_MODEL_BRANDING} | עמוד ${i} מתוך ${pageCount}`, 105, 290, { align: 'center' });
    }

    // Save PDF
    doc.save(`VO_Letter_${new Date().getTime()}.pdf`);
};
