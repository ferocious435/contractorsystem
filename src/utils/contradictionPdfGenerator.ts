import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { HEBREW_FONT_BASE64 } from './fonts/hebrewFont';
import { AI_MODEL_BRANDING } from './constants';

import { ContradictionItem } from '../types';

interface PDFGeneratorProps {
    projectName: string;
    contradictions: ContradictionItem[];
}

export const generateContradictionPDF = ({
    projectName,
    contradictions
}: PDFGeneratorProps) => {
    if (!contradictions || contradictions.length === 0) {
        alert('אין ממצאים לייצוא. יש להריץ סריקה מלאה תחילה.');
        return;
    }

    // Create portrait A4 document
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    // Add Hebrew Font
    doc.addFileToVFS('Rubik-Regular.ttf', HEBREW_FONT_BASE64);
    doc.addFont('Rubik-Regular.ttf', 'Rubik', 'normal');
    doc.setFont('Rubik');

    const safeText = (text: unknown): string => {
        if (text === null || text === undefined || text === '') return '-';
        return String(text);
    };

    const asRecord = (value: unknown): Record<string, unknown> =>
        value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

    // --- Header Section ---
    doc.setFillColor(21, 28, 36);
    doc.rect(0, 0, 210, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text('דו"ח אבחון הנדסי-מסחרי: ניתוח סתירות ושינויים', 200, 20, { align: 'right' });
    
    doc.setFontSize(12);
    doc.text(`פרויקט: ${projectName}`, 200, 32, { align: 'right' });
    doc.text(`תאריך הפקה: ${new Date().toLocaleDateString('he-IL')}`, 20, 32);

    // --- Summary Section ---
    let yPos = 55;
    doc.setTextColor(21, 28, 36);
    doc.setFontSize(16);
    doc.text('סיכום ממצאים', 200, yPos, { align: 'right' });
    
    yPos += 10;
    doc.setFontSize(11);
    const highCount = contradictions.filter(c => c.category === 'סתירה' || c.severity === 'HIGH').length;
    const summary = `במהלך האבחון ההנדסי של מערכת ${AI_MODEL_BRANDING}, זוהו ${contradictions.length} ממצאים הנדסיים (${highCount} סתירות מהותיות) המצריכים התייחסות מסחרית מול מזמין העבודה.`;
    const splitSummary = doc.splitTextToSize(summary, 180);
    doc.text(splitSummary, 200, yPos, { align: 'right' });
    
    yPos += (splitSummary.length * 6) + 10;

    // --- Detailed Findings ---
    contradictions.forEach((c, index) => {
        if (yPos > 240) {
            doc.addPage();
            yPos = 20;
        }

        // Card Title background
        doc.setFillColor(248, 250, 252);
        doc.rect(10, yPos, 190, 8, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.line(10, yPos, 10, yPos + 80);

        doc.setFontSize(13);
        doc.setTextColor(15, 23, 42);
        doc.text(`${index + 1}. ${safeText(c.title)}`, 195, yPos + 6, { align: 'right' });
        
        yPos += 15;

        // Metadata
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        const clauseRef = safeText(c.evidence_data?.clause_reference || c.category || 'כללי');
        doc.text(`סעיף: ${clauseRef}`, 195, yPos, { align: 'right' });
        
        const severityLabel = c.category || (c.severity === 'HIGH' ? 'סתירה' : c.severity === 'MEDIUM' ? 'שינוי/הנחיה' : 'אירוע שטח');
        doc.text(`סיווג: ${severityLabel}`, 140, yPos, { align: 'right' });
        
        yPos += 10;

        // Contract vs Execution quotes table
        const contractQuote = safeText(c.evidence_data?.contract_quote);
        const workQuote = safeText(c.evidence_data?.work_quote);

        autoTable(doc, {
            startY: yPos,
            margin: { right: 15, left: 15 },
            theme: 'plain',
            styles: { font: 'Rubik', halign: 'right', fontSize: 9 },
            head: [[
                { content: 'מסמך ביצוע [2]', styles: { textColor: [239, 68, 68], fontStyle: 'bold' } },
                '',
                { content: 'חוזה [1]', styles: { textColor: [16, 185, 129], fontStyle: 'bold' } }
            ]],
            columnStyles: {
                0: { cellWidth: 85 },
                1: { cellWidth: 10, halign: 'center' },
                2: { cellWidth: 85 }
            },
            body: [
                [
                    { content: workQuote, styles: { textColor: [239, 68, 68] } },
                    'מול',
                    { content: contractQuote, styles: { textColor: [16, 185, 129] } }
                ]
            ],
            didDrawPage: (data) => {
                yPos = data.cursor?.y || yPos;
            }
        });

        yPos = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

        // Financial Impact - uses financial_impact_desc from evidence_data
        const financialDesc = safeText(
            c.evidence_data?.financial_impact_desc ||
            c.evidence_data?.business_value
        );
        if (financialDesc !== '-') {
            if (yPos > 260) { doc.addPage(); yPos = 20; }
            doc.setFontSize(10);
            doc.setTextColor(15, 23, 42);
            doc.text('השפעה פיננסית:', 195, yPos, { align: 'right' });
            yPos += 6;
            doc.setTextColor(60, 60, 60);
            const finLines = doc.splitTextToSize(financialDesc, 180);
            doc.text(finLines, 195, yPos, { align: 'right' });
            yPos += (finLines.length * 5) + 6;
        }

        // --- Expert Strategy Section (if exists) ---
        const expert = asRecord(c.evidence_data?.expert_strategy);
        if (Object.keys(expert).length > 0) {
            if (yPos > 230) { doc.addPage(); yPos = 20; }
            
            doc.setFillColor(241, 245, 249);
            doc.rect(15, yPos, 180, 50, 'F'); // Background box for expert section
            
            doc.setFontSize(10);
            doc.setTextColor(30, 41, 59);
            doc.setFont('Rubik', 'bold');
            doc.text('אבחון מומחה הנדסי-מסחרי:', 190, yPos + 6, { align: 'right' });
            
            doc.setFont('Rubik', 'normal');
            doc.setFontSize(9);
            yPos += 12;
            
            const renderExpertField = (label: string, value: string, color: [number, number, number]) => {
                if (!value || value === '-') return;
                doc.setTextColor(color[0], color[1], color[2]);
                doc.setFont('Rubik', 'bold');
                doc.text(`${label}:`, 190, yPos, { align: 'right' });
                doc.setFont('Rubik', 'normal');
                doc.setTextColor(51, 65, 85);
                const lines = doc.splitTextToSize(value, 140);
                doc.text(lines, 185 - (doc.getTextWidth(`${label}:`) + 2), yPos, { align: 'right' });
                yPos += (lines.length * 4.5) + 3;
            };

            renderExpertField('בסיס הנדסי', safeText(expert.technical_foundation), [15, 23, 42]);
            renderExpertField('טיעון מקצועי', safeText(expert.professional_argument), [37, 99, 235]);
            renderExpertField('הנחיה ליומן', safeText(expert.site_diary_instruction), [5, 150, 105]);
            renderExpertField('הערכת סיכון', safeText(expert.risk_assessment), [220, 38, 38]);
            
            yPos += 5;
        } else {
            // Strategy Advice (fallback for items without expert analysis)
            const adviceText = safeText(
                c.strategy_advice ||
                c.evidence_data?.strategy_advice ||
                c.evidence_data?.justification ||
                c.description
            );
            if (adviceText !== '-') {
                if (yPos > 260) { doc.addPage(); yPos = 20; }
                doc.setFontSize(10);
                doc.setTextColor(37, 99, 235);
                doc.text('המלצה לניהול אירוע:', 195, yPos, { align: 'right' });
                yPos += 6;
                doc.setTextColor(15, 23, 42);
                const adviceLines = doc.splitTextToSize(adviceText, 180);
                doc.text(adviceLines, 195, yPos, { align: 'right' });
                yPos += (adviceLines.length * 5) + 6;
            }
        }

        // Commercial risk
        const risk = safeText(c.evidence_data?.commercial_risk);
        if (risk !== '-') {
            if (yPos > 260) { doc.addPage(); yPos = 20; }
            doc.setFontSize(9);
            doc.setTextColor(150, 100, 0);
            doc.text(`סיכון מסחרי: ${risk}`, 195, yPos, { align: 'right' });
            yPos += 5;
        }

        yPos += 12;
    });

    // --- Footer ---
    const pageCount = (doc as unknown as { internal: { getNumberOfPages(): number } }).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`דוח בינה מלאכותית ${AI_MODEL_BRANDING} | עמוד ${i} מתוך ${pageCount}`, 105, 285, { align: 'center' });
    }

    // Save PDF
    const timestamp = new Date().toLocaleDateString('he-IL').replace(/\./g, '-');
    doc.save(`דוח_סתירות_${projectName}_${timestamp}.pdf`);
};
