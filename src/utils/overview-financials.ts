import {VAT_RATE} from './constants';
import {prepareLetterFinancialSnapshot} from './letter-financials';
import type {IndividualPricingInput} from './individual-pricing';
import {getAmountVat,getMoneySum,getPreferredProjectAmount,isTrustedBaseContractRow,isVisibleLedgerRow} from './project-financials';

export interface OverviewFinancials {
    originalBudget: number | null;
    approvedVO: number | null;
    pendingVO: number | null;
    projectedNet: number | null;
    projectedVat: number | null;
    projectedGross: number | null;
    financialIssueCount: number;
}
type Row=IndividualPricingInput&{source?:string|null};
const number=(value:unknown):number|null=>{
    if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')return null;
    const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;
};

/** Reuse the letter's individual rounding; viewing sent work grants no new letter eligibility. */
export function getOverviewFinancials(rows:readonly Row[],projectBudget:unknown):OverviewFinancials{
    const normalized=rows.map(row=>({...row,quantity:number(row.quantity),unit_price_excl_vat:number(row.unit_price_excl_vat),
        total_price_excl_vat:number(row.total_price_excl_vat),vat_rate:number(row.vat_rate),
        evidence_data:row.evidence_data&&typeof row.evidence_data==='object'?row.evidence_data as Record<string,unknown>|unknown[]:null}));
    const manual=number(projectBudget);
    let originalBudget=manual!==null||normalized.some(isTrustedBaseContractRow)?getPreferredProjectAmount(manual,normalized):null;
    if(originalBudget!==null&&!Number.isSafeInteger(Math.round(originalBudget*100)))originalBudget=null;
    const variations=normalized.filter(row=>isVisibleLedgerRow(row)&&row.type!=='BASE_CONTRACT');
    const calculate=(items:typeof variations)=>items.length?prepareLetterFinancialSnapshot(items,{includeSentInSummary:true}):
        {ok:true as const,snapshot:{totals:{net:0,vat:0,gross:0}}};
    const all=calculate(variations);
    const ambiguous=new Set(all.ok?[]:all.issues.filter(issue=>['duplicate-conflict','alternative-conflict'].includes(issue.reason)).map(issue=>issue.itemId));
    const scopedNet=(types:string[])=>{
        const items=variations.filter(row=>types.includes(String(row.type)));
        if(items.some(row=>ambiguous.has(String(row.id))))return null;
        const result=calculate(items);return result.ok?result.snapshot.totals.net:null;
    };
    const result:OverviewFinancials={originalBudget,approvedVO:scopedNet(['APPROVED_VO','SENT_VO']),pendingVO:scopedNet(['PENDING_VO']),
        projectedNet:null,projectedVat:null,projectedGross:null,financialIssueCount:all.ok?0:new Set(all.issues.map(issue=>issue.itemId)).size};
    if(originalBudget!==null&&all.ok){
        const baseVat=getAmountVat(originalBudget,VAT_RATE),totals=all.snapshot.totals;
        const projectedNet=getMoneySum([originalBudget,totals.net]),projectedVat=getMoneySum([baseVat,totals.vat]);
        const projectedGross=getMoneySum([originalBudget,baseVat,totals.gross]);
        if([projectedNet,projectedVat,projectedGross].every(value=>Number.isSafeInteger(Math.round(value*100)))){
            Object.assign(result,{projectedNet,projectedVat,projectedGross});
        }else result.financialIssueCount++;
    }
    return result;
}
