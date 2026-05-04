import { genAI, GEMINI_CONFIG } from "@/lib/gemini";
import { NextResponse } from "next/server";

const model = genAI.getGenerativeModel({ model: GEMINI_CONFIG.STABLE_FLASH });

export async function POST(req: Request) {
    try {
        const { projectId, letterType, recipient, subject, keyPoints, tone, items } = await req.json();

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ success: false, error: "API Key missing" }, { status: 500 });
        }

        const itemsContext = items.map((item: any) => {
            const evidenceStr = item.evidence_data && Array.isArray(item.evidence_data) 
                ? item.evidence_data.map((ev: any) => `- ${ev.document_title || 'מסמך'} (עמ' ${ev.page || '?'})`).join('\n              ')
                : 'אין הוכחות מתועדות';

            return `
            - פריט: ${item.description}
            - קוד: ${item.code}
            - כמות: ${item.quantity} ${item.unit}
            - מחיר יחידה: ${item.price} ₪
            - סה"כ: ${item.total} ₪
            - נימוק: ${item.ai_rationale || 'לא צוין'}
            - הערות: ${JSON.stringify(item.governing_notes) || 'אין'}
            - הוכחות (Evidence Links):
              ${evidenceStr}
            `;
        }).join('\n');

        const typeSpecificInstructions = {
            rfi: "זהו מכתב הבהרה (RFI). הטון צריך להיות שאלתי ומקצועי. התמקד בבקשת הנחיות לגבי סתירות או אי-בהירויות בתוכניות המונעות את המשך העבודה התקין.",
            vo_request: "זוהי דרישת תשלום לחריגים (VO Request). הטון צריך להיות דורש אך מקצועי. הדגש כי העבודות המפורטות אינן חלק מההסכם המקורי ובוצעו/מבוצעות לבקשת המזמין.",
            official_vo: "זוהי פקודת שינויים רשמית (Official VO). הטון צריך להיות סמכותי וסיכומי. המכתב מהווה תיעוד סופי של השינויים שאושרו והשפעתם על לוחות הזמנים והתקציב."
        }[letterType as 'rfi' | 'vo_request' | 'official_vo'] || "";

        const toneMap: Record<string, string> = {
            professional: "מקצועי וענייני (Professional/Objective). התמקד בעובדות ובנתונים.",
            formal: "פורמלי ורשמי מאוד. שימוש בשפה משפטית גבוהה.",
            firm: "תקיף ודורש זכויות (Firm/Assertive). הדגש את חובות המזמין.",
            aggressive: "אגרסיבי ולוחמני. השתמש במושגים של התראה לפני נקיטת צעדים, הפרת חוזה ודרישה חד משמעית לתיקון המצב.",
            friendly: "נעים, משתף פעולה ומכיל. הדגש את הרצון להמשך עבודה תקינה ופתרון משותף של הסוגיות.",
            skeleton: "שלד / מבנה בלבד (Skeleton). אל תכתוב את המכתב המלא. ספק רק את הכותרות, סדר הנושאים ונקודות המפתח. בכל מקום שנדרש תוכן, שים Placeholder בסגנון [כאן להוסיף את הטיעון האישי/הסבר על...]. זה נועד לאפשר למשתמש לכתוב את המכתב בעצמו על בסיס המבנה."
        };
        const toneInstructions: string = toneMap[tone as string] || "מקצועי";

        const prompt = `
            אתה מומחה בכיר לניהול פרויקטי בנייה ומשפט חוזי בישראל, המתמחה בניסוח מכתבים רשמיים עבור קבלנים.
            המשימה שלך היא לכתוב ${tone === 'skeleton' ? 'שלד למכתב' : 'מכתב'} רשמי בעברית עבור קבלן בנייה המופנה ל${recipient || 'מזמין העבודה'}.
            
            הנחיה ספציפית לסוג המסמך (${letterType}):
            ${typeSpecificInstructions}
 
            סגנון כתיבה (Tone) הנדרש:
            ${toneInstructions}

            פרטי המכתב:
            - נושא: ${subject || 'דרישה לתשלום עבור חריגים ושינויים'}
            - דגשים נוספים מהמשתמש: ${keyPoints || 'אין'}
            
            הפריטים הרלוונטיים מהלג'ר (Pricing Ledger):
            ${itemsContext}
            
            מבנה המכתב הנדרש:
            1. פתיח: התייחסות רשמית לנמען, ציון הנושא וסימוכין רלוונטיים.
            2. רקע: הסבר קצר על נסיבות העניין (סתירה בתוכניות, בקשת שינוי בשטח, וכו').
            3. פירוט טכני-כספי: סקירה של הפריטים המופיעים ברשימה לעיל.
               **חשוב מאוד**: השתמש ב"הוכחות (Evidence Links)" לכל פריט. ציין בתוך הטקסט את שם המסמך ומספר העמוד כהוכחה חותכת לזכאות הקבלן.
            4. סיכום כספי: (במידה ורלוונטי) הצגת הסכום הכולל (לפני מע"מ) וציון מפורש שמע"מ בשיעור 18% יתווסף כחוק.
            5. חתימה: סיומת מקצועית ומקום לחתימת מורשה חתימה.
 
            דגשים מקצועיים:
            - השתמש במינוח מקצועי כגון: "סעיף חוזי", "כתב כמויות", "פקודת שינויים", "אישור מפקח בשטח", "סעיפי הצמדה".
            ${tone === 'skeleton' ? '- צור מבנה ברור עם כותרות והערות בסוגריים עבור המשתמש.' : '- המכתב צריך להיות מוכן לחתימה, אך מותאם לסגנון שנבחר.'}
            
            פלט ה${tone === 'skeleton' ? 'שלד' : 'מכתב'} בלבד (ללא טקסט מקדים או הסברים):
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return NextResponse.json({ success: true, letter: text });
    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
