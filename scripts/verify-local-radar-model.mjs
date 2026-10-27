import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import { CONTRACT_DOCUMENT_HIERARCHY_GUIDE } from '../src/utils/contract-document-hierarchy.ts';

import {
  assessContractScanFinding,
  assertGeneratedScanSources,
  buildContractScanPrompt,
  buildGroundedScanResponseSchema,
  evaluateHydrantTimelineResult,
  findingHasActionableWorkEvidence,
  findingIsSupersededByLaterEvidence,
  groundContractScanFinding,
} from '../src/utils/contract-scan-quality.ts';
import { parseScanFindings } from '../src/utils/scan-ai-response.ts';
const projectHook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { buildDocumentScanChunks, formatContractComparisonContext } = await import('../src/utils/document-scan-chunks.ts');
dotenv.config({ path: '.env.local' });
const { generateComparisonText, getComparisonAiIdentity } = await import('../src/lib/comparison-ai.ts');
projectHook.deregister();
const identity = getComparisonAiIdentity(process.env);
assert.equal(identity.kind, 'ollama', 'Acceptance must use the product’s configured local provider');
const model = identity.model;
const requestAudit = [];

async function runCase(testCase) {
  const comparisonDocuments = [...testCase.contracts, ...(testCase.referenceContracts || [])];
  const prompt = buildContractScanPrompt({
    contractHierarchyGuide: CONTRACT_DOCUMENT_HIERARCHY_GUIDE,
    contractContext: testCase.referenceContracts ? formatContractComparisonContext(
      buildDocumentScanChunks(testCase.contracts), buildDocumentScanChunks(testCase.referenceContracts), testCase.workDocument.extracted_text,
    ) : testCase.contracts.map((document) => `--- Document ID: ${document.id}\nTitle: ${document.title}\n${document.extracted_text}`).join('\n\n'),
    relatedWorkContext: testCase.relatedTimeline || '',
    workDoc: testCase.workDocument,
    workChunk: {
      index: 0,
      total: 1,
      start: 0,
      end: testCase.workDocument.extracted_text.length,
      text: testCase.workDocument.extracted_text,
    },
    contractChunksIndexed: comparisonDocuments.length,
    contractSourceChars: comparisonDocuments.reduce((sum, document) => sum + document.extracted_text.length, 0),
    projectWorkChunksIndexed: testCase.projectWorkChunks || 1,
  });
  const responseFormat = buildGroundedScanResponseSchema({workText:testCase.workDocument.extracted_text,
    contractTexts:comparisonDocuments.map(document=>document.extracted_text)});
  if(process.env.RADAR_REQUEST_AUDIT){requestAudit.push({name:testCase.name,prompt,responseFormat});return {name:testCase.name,durationSeconds:0};}
  const startedAt = performance.now();
  let rawFindings;
  let lastError;
  for (const numPredict of [1024, 1536]) {
    let response = '';
    try {
      response = await generateComparisonText(prompt, process.env, {
        responseFormat, numCtx: 8192, numPredict,
        temperature: 0, seed: 42, timeoutMs: numPredict === 1024 ? 180_000 : 240_000,
      });
      rawFindings = parseScanFindings(response, { requireSemantic: true });
      assertGeneratedScanSources({ findings: rawFindings, currentWorkDocument: testCase.workDocument, contractDocuments: comparisonDocuments });
      break;
    } catch (error) {
      rawFindings = undefined;
      lastError = error;
      const name = testCase.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 90);
      fs.writeFileSync(new URL(`../data/point1-audit/model-response-${name}-${numPredict}.json`, import.meta.url),
        JSON.stringify({ name: testCase.name, response, error: error.message }, null, 2));
    }
  }
  if (!rawFindings) throw lastError || new Error('Ollama did not return findings');
  const assessments = rawFindings.map((finding) => {
    const groundedFinding = groundContractScanFinding({
      finding,
      currentWorkDocument: testCase.workDocument,
      contractDocuments: comparisonDocuments,
    });
    return {
    finding: groundedFinding,
    quality: assessContractScanFinding({
      finding: groundedFinding,
      currentWorkDocument: testCase.workDocument,
      contractDocuments: comparisonDocuments,
    }),
  }});
  const acceptedFindings = assessments
    .filter(({ quality }) => quality.accepted)
    .filter(({ finding, quality }) => findingHasActionableWorkEvidence({
      finding,
      currentWorkDocument: testCase.workDocument,
      assessment: quality,
    }))
    .map(({ finding, quality }) => ({ ...finding, category: quality.category,
      ...quality.presentation, semantic_assessment: quality.evidenceRelation }))
    .filter((finding) => !findingIsSupersededByLaterEvidence({
      finding,
      currentWorkDocument: testCase.workDocument,
      relatedWorkDocuments: testCase.relatedDocuments || [],
    }));
  const result = {
    name: testCase.name,
    durationSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(1)),
    rawFindings,
    acceptedFindings,
    rejectedReasons: assessments.filter(({ quality }) => !quality.accepted).flatMap(({ quality }) => quality.reasons),
  };
  console.log(JSON.stringify(result, null, 2));
  testCase.assertResult(result);
  return result;
}

const hydrantContract = {
  id: 'contract-boq',
  title: 'כתב כמויות',
  category: 'BOQ',
  extracted_text: '57.90.0018 ברז כיבוי אש הידרנט כפול תוצרת רפאל או שווה ערך.',
};

// Synthetic fixtures: this period is not a finding about the real project's terms.
const responseSpecification = {
  id: 'special-specification-response', title: 'מפרט מיוחד', category: 'SPECS',
  extracted_text: 'המזמין ימסור תשובה לבקשה בתוך 14 ימים קלנדריים מיום קבלת הבקשה.',
};
const unansweredRequest = 'הבקשה התקבלה אצל המזמין ביום 01.01.2025. נכון ליום 25.01.2025 לא נמסרה תשובה לבקשה.';

const cases = [
  {
    name: 'the default Blue Book basis does not require a direct incorporation sentence',
    contracts: [{ id: 'project-contract', title: 'תנאי הפרויקט', category: 'CONTRACT',
      extracted_text: 'מסמכי הפרויקט כוללים כתב כמויות ומפרט מיוחד. לא נקבע שינוי לבסיס המפרט הכללי.' }],
    referenceContracts: [{ id: 'default-blue-57', title: 'המפרט הכללי פרק 57 מהדורת 2023, סעיף מאומת', category: 'INCORPORATED_REFERENCE',
      extracted_text: 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.' }],
    workDocument: { id: 'different-wrap', title: 'הוראת עטיפה', category: 'PROTOCOL',
      extracted_text: 'המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.' },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 1);
      assert.equal(result.acceptedFindings[0].contract_document_id, 'default-blue-57');
      assert.equal(result.acceptedFindings[0].category, 'סתירה');
    },
  },
  {
    name: 'a verified default chapter remains usable when the contract excludes another chapter',
    contracts: [{ id: 'scoped-exclusion', title: 'מפרט מיוחד', category: 'SPECS', extracted_text: 'פרק 51 של המפרט הכללי לא יחול על העבודה.' }],
    referenceContracts: [{ id: 'allowed-default-57', title: 'המפרט הכללי פרק 57 מהדורת 2023, סעיף מאומת', category: 'INCORPORATED_REFERENCE',
      extracted_text: 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.' }],
    workDocument: { id: 'changed-wrap-after-exclusion', title: 'הוראת עטיפה', category: 'PROTOCOL',
      extracted_text: 'המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.' },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 1);
      assert.equal(result.acceptedFindings[0].contract_document_id, 'allowed-default-57');
      assert.equal(result.acceptedFindings[0].category, 'סתירה');
    },
  },
  {
    name: 'an incorporated normative clause participates in the initial comparison with its own exact source',
    contracts: [{ id: 'incorporating-spec', title: 'מפרט מיוחד', category: 'SPECS',
      extracted_text: 'על עבודות הצנרת יחול פרק 57 של המפרט הכללי מהדורת 2023.' }],
    referenceContracts: [{ id: 'reference-page-57', title: 'המפרט הכללי פרק 57 מהדורת 2023', category: 'INCORPORATED_REFERENCE',
      extracted_text: 'עטיפת הצינור תבוצע בחול מצומנט בשיעור 8%.' }],
    workDocument: { id: 'new-pipe-wrap-instruction', title: 'פרוטוקול עטיפת צינור', category: 'PROTOCOL',
      extracted_text: 'המפקח דורש לבצע עטיפת הצינור בחול מצומנט בשיעור 4%.' },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 1);
      assert.equal(result.acceptedFindings[0].contract_document_id, 'reference-page-57');
      assert.equal(result.acceptedFindings[0].category, 'סתירה');
    },
  },
  {
    name: 'an allowed hydrant supplier discussion is not an instruction mismatch',
    contracts: [hydrantContract],
    workDocument: {
      id: 'protocol-2025-06-04',
      title: 'פרוטוקול 04.06.2025',
      category: 'PROTOCOL',
      extracted_text: 'התאגיד מוכן לשקול עבודה עם שני ספקי הידרנטים לאחר קבלת חלוקה מפורטת לפי אזורים וספקים.',
    },
    relatedTimeline: `
--- Related work document ID: protocol-2024-12-16
Title: פרוטוקול 16.12.2024
הקבלן העביר לאישור הידרנטים של רפאל.

--- Related work document ID: protocol-2025-01-01
Title: פרוטוקול 01.01.2025
החומרים שהגיש הקבלן להידרנטים ולמגופים אושרו על ידי המתכנן ונציג התאגיד.

--- Related work document ID: protocol-2025-01-22
Title: פרוטוקול 22.01.2025
אישור החומרים שהגיש הקבלן נשאר בתוקף.`,
    projectWorkChunks: 4,
    assertResult(result) {
      const evaluation = evaluateHydrantTimelineResult(result.acceptedFindings);
      assert.equal(evaluation.forbiddenContradiction, false, 'resolved hydrant approval must not be a contradiction');
      assert.equal(evaluation.currentActionFound, false, 'a standalone zone/supplier task is not a mismatch');
      assert.equal(result.acceptedFindings.length, 0, 'no conflicting instruction was supplied');
    },
  },
  {
    name: 'direct warranty conflict has two exact sources',
    contracts: [{
      id: 'contract-warranty',
      title: 'תנאי חוזה',
      category: 'CONTRACT',
      extracted_text: 'תקופת האחריות לכל אביזרי הצנרת היא 12 חודשים ממועד המסירה.',
    }],
    workDocument: {
      id: 'protocol-warranty',
      title: 'פרוטוקול אחריות',
      category: 'PROTOCOL',
      extracted_text: 'המפקח דורש מהקבלן לתת אחריות של 15 שנים על אביזרי FOX ממועד המסירה.',
    },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 1, 'direct conflict must create one finding');
      assert.equal(result.acceptedFindings[0].category, 'סתירה');
      assert.equal(result.acceptedFindings[0].semantic_assessment.relation, 'INCOMPATIBLE');
    },
  },
  {
    name: 'a documented missed response deadline in a binding specification creates a mismatch',
    contracts: [responseSpecification],
    workDocument: {
      id: 'overdue-response-record', title: 'פרוטוקול 25.01.2025', category: 'PROTOCOL',
      extracted_text: unansweredRequest,
    },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 1, 'a proven missed response deadline must be retained');
      assert.equal(result.acceptedFindings[0].category, 'סתירה');
      assert.equal(result.acceptedFindings[0].contract_document_id, responseSpecification.id);
      assert.equal(result.acceptedFindings[0].comparison_type, 'contractual_response_deadline');
    },
  },
  {
    name: 'a pending response within the specification deadline creates no mismatch',
    contracts: [responseSpecification],
    workDocument: {
      id: 'not-yet-due-response', title: 'פרוטוקול 08.01.2025', category: 'PROTOCOL',
      extracted_text: unansweredRequest.replace('25.01.2025', '08.01.2025'),
    },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 0, 'ordinary waiting before the deadline is not a breach');
    },
  },
  {
    name: 'later approval suppresses an old open issue',
    contracts: [hydrantContract],
    workDocument: {
      id: 'protocol-2024-12-16',
      title: 'פרוטוקול 16.12.2024',
      category: 'PROTOCOL',
      extracted_text: 'הקבלן העביר לאישור הידרנטים של רפאל.',
    },
    relatedTimeline: `--- Related work document ID: protocol-2025-01-22\nTitle: פרוטוקול 22.01.2025\nהחומרים שהגיש הקבלן להידרנטים ולמגופים אושרו על ידי המתכנן ונציג התאגיד.`,
    relatedDocuments: [{
      id: 'protocol-2025-01-22',
      title: 'פרוטוקול 22.01.2025',
      category: 'PROTOCOL',
      extracted_text: 'החומרים שהגיש הקבלן להידרנטים ולמגופים אושרו על ידי המתכנן ונציג התאגיד.',
    }],
    projectWorkChunks: 2,
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 0, 'resolved old issue must return no current finding');
    },
  },
  {
    name: 'neutral meeting note creates no finding',
    contracts: [hydrantContract],
    workDocument: {
      id: 'protocol-neutral',
      title: 'פרוטוקול שבועי',
      category: 'PROTOCOL',
      extracted_text: 'בישיבה נסקר מצב הניקיון באתר. לא ניתנו הוראות חדשות ולא נרשמו שינויים.',
    },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 0, 'neutral text must not create noise');
    },
  },
  {
    name: 'unrelated contract text cannot turn a real delay notice into a contradiction',
    contracts: [{
      id: 'as-built-contract',
      title: 'מפרט מסירה',
      category: 'CONTRACT',
      extracted_text: 'עם סיום העבודה יגיש הקבלן מפת עדות ותכניות DWG של המצב שבוצע.',
    }],
    workDocument: {
      id: 'traffic-protocol',
      title: 'פרוטוקול 17.06.2025',
      category: 'PROTOCOL',
      extracted_text: 'הקבלן התריע על עיכובים רבים בלוח הזמנים לביצוע הסדרי התנועה הסופיים.',
    },
    assertResult(result) {
      assert.equal(
        result.acceptedFindings.some((finding) => finding.category === 'סתירה'),
        false,
        'unrelated contract text must not create a contradiction',
      );
      for (const finding of result.acceptedFindings) {
        assert.equal(
          finding.work_quote,
          'הקבלן התריע על עיכובים רבים בלוח הזמנים לביצוע הסדרי התנועה הסופיים.',
          'a delay action must remain grounded in the exact work-document sentence',
        );
      }
    },
  },
  {
    name: 'letter header does not prove a change',
    contracts: [hydrantContract],
    workDocument: {
      id: 'letter-header',
      title: 'מכתב 17.06.2025',
      category: 'LETTER',
      extracted_text: '17.06.2025 לכבוד: תאגיד המים – מי גת\nהנדון: בדיקת קידוח MTM',
    },
    assertResult(result) {
      assert.equal(result.acceptedFindings.length, 0, 'a date, addressee, or subject line is not evidence');
    },
  },
];

// Targeted model acceptance uses the product adapter and never writes findings.
for (const [name, work, baseline, incompatible, unresolvedPrice] of [
  ['an exact value inside an allowed material range', 'עטיפת הצינור תבוצע בחול מצומנט 6%.', 'עטיפת הצינור תבוצע בחול מצומנט 4–8%.', false],
  ['different numeric properties are not a conflict', 'לוח הזמנים מצביע על עיכוב של 17 חודשים.', 'תקופת הביצוע תהיה 19 חודשים.', false],
  ['different pipe layers are not a conflict', 'עטיפת הצינור תבוצע בחול מצומנט 8%.', 'חומר מילוי תחתון יהיה חומר מילוי אינרטי.', false],
  ['different words for the same property still expose a conflict', 'המפקח דורש שהמילוי סביב הצינור יהיה חול מצומנט 4%.', 'עטיפת הצינור תבוצע בחול מיוצב בצמנט 8%.', true],
  ['method instruction bypasses governing written approval', 'המפקח מורה לבצע קידוח MTM ללא אישור המנהל.', 'שינוי שיטת הביצוע טעון אישור מראש ובכתב של המנהל.', true],
  ['response demand below an explicit minimum', 'המפקח דורש להעביר תשובה בתוך 3 ימי עבודה ממועד המכתב.', 'אין לדרוש מהקבלן תשובה בתוך פחות מ-7 ימי עבודה ממועד המכתב.', true],
  ['permitted method instruction has no contradiction', 'המפקח מורה בכתב לבצע את הקידוח בשיטת MTM.', 'המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.', false],
  ['method power alone does not establish an imposed price', 'המפקח דורש לבצע בשיטת MTM ללא תוספת מחיר.', 'המפקח רשאי להורות על שינוי שיטת הביצוע בכתב.', false, true],
]) cases.push({ name, contracts: [{ id: 'semantic-base', title: 'מפרט.docx', category: 'SPECS', extracted_text: baseline }],
  workDocument: { id: 'semantic-work', title: 'הוראה.docx', category: 'PROTOCOL', extracted_text: work },
  assertResult(result) {
    if (incompatible) {
      assert.equal(result.acceptedFindings.length, 1);
      assert.equal(result.acceptedFindings[0].semantic_assessment.relation, 'INCOMPATIBLE');
      assert.equal(result.acceptedFindings[0].category, 'סתירה');
    } else if (unresolvedPrice) {
      // The imposed price is an unresolved project issue, unlike a neutral or
      // fully permitted instruction. It must never become a proved conflict.
      for (const finding of result.acceptedFindings) {
        assert.equal(finding.category, 'חוסר נתונים');
        assert.equal(finding.semantic_assessment.relation, 'INSUFFICIENT_EVIDENCE');
        assert.ok(finding.semantic_assessment.reasons.includes('method_authority_does_not_establish_price_or_waiver'));
      }
    } else assert.equal(result.acceptedFindings.length, 0);
  },
});

const results = [];
const failures = [];
for (const testCase of cases.filter(item => !process.argv[2] || item.name.includes(process.argv[2]))) {
  try { results.push(await runCase(testCase)); }
  catch (error) {
    failures.push({ name: testCase.name, error: error.message });
    console.error(JSON.stringify(failures.at(-1)));
  }
}

if(process.env.RADAR_REQUEST_AUDIT){fs.writeFileSync(process.env.RADAR_REQUEST_AUDIT,JSON.stringify(requestAudit,null,2));console.log(JSON.stringify({captureOnly:true,cases:requestAudit.length}));}
else console.log(JSON.stringify({
  passed: failures.length === 0,
  model,
  cases: results.length,
  totalDurationSeconds: Number(results.reduce((sum, result) => sum + result.durationSeconds, 0).toFixed(1)),
  results,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
