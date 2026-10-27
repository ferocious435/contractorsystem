import './load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const {ProjectNavigation}=await import('../../src/components/layout/ProjectNavigation.tsx');
const {ProjectPortfolio,filterPortfolioProjects}=await import('../../src/components/layout/ProjectPortfolio.tsx');
const {ProjectFormContent,ProjectDeleteContent}=await import('../../src/components/layout/ProjectFormDialog.tsx');
const {UnavailableView}=await import('../../src/components/layout/UnavailableView.tsx');
const {renderWorkspaceEntryError}=await import('../../src/utils/workspace-entry-error.ts');
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const projects=[{id:'one',name:'פרויקט C-CE6070 · שיקום התשתיות והכבישים ברחוב הארוך',client_name:'לקוח צפוני',budget:148620450.75,displayAmount:148620450.75,status:'ACTIVE'},{id:'two',name:'פרויקט דרומי',client_name:'SECOND CLIENT',budget:null,status:'ACTIVE'}];

test('all nine project destinations are named buttons with a single current destination',()=>{
  let navigations=0;
  const html=render(ProjectNavigation,{currentView:'radar',onNavigate:()=>navigations++});
  for(const name of ['לוח בקרה','מסמכי חוזה','ביצוע ושטח','מכ"ם סתירות','תמחור חריגים','מחירונים','מחולל מכתבים','יועץ בינה מלאכותית','הגדרות מערכת'])assert.ok(html.includes(`aria-label="${name.replaceAll('"','&quot;')}"`),name);
  assert.equal((html.match(/aria-current="page"/gu)||[]).length,1);
  assert.equal((html.match(/<button/gu)||[]).length,9);
  assert.equal(navigations,0,'rendering the navigation must not switch the active view');
});

test('portfolio search uses the already loaded names and clients without altering the source collection',()=>{
  assert.deepEqual(filterPortfolioProjects(projects,'c-ce6070').map(p=>p.id),['one']);
  assert.deepEqual(filterPortfolioProjects(projects,' second client ').map(p=>p.id),['two']);
  assert.deepEqual(filterPortfolioProjects(projects,'צפוני').map(p=>p.id),['one']);
  assert.equal(filterPortfolioProjects(projects,'').length,2);
  assert.equal(filterPortfolioProjects(projects,'missing project').length,0);
  assert.equal(projects.length,2);
});

test('portfolio keeps the complete name and financial precision, and does not create or delete while rendering',()=>{
  let writes=0;
  const html=render(ProjectPortfolio,{projects,isLoading:false,onOpen:()=>{},onCreate:()=>writes++,onEdit:()=>writes++,onDelete:async()=>{writes++;return true;},openMenuId:null,onToggleMenu:()=>{}});
  assert.ok(html.includes(projects[0].name));
  const amount=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:0,maximumFractionDigits:3}).format(projects[0].displayAmount);
  assert.ok(html.includes(amount),'the portfolio has a separate precision role from ledger totals');
  assert.match(html,/<bdi[^>]*dir="rtl"/u);
  assert.equal(writes,0);
});

test('unknown project amounts remain unknown while an explicit zero is preserved',()=>{
  const props={isLoading:false,onOpen:()=>{},onCreate:()=>{},onEdit:()=>{},onDelete:async()=>true,openMenuId:null,onToggleMenu:()=>{}};
  const unknown=render(ProjectPortfolio,{...props,projects:[projects[1]]});
  assert.ok(unknown.includes('הסכום לא צוין'));
  const known=render(ProjectPortfolio,{...props,projects:[{...projects[1],budget:0,displayAmount:0}]});
  assert.ok(!known.includes('הסכום לא צוין'));
});

test('a failed read is different from an empty portfolio and offers the same read again',()=>{
  const props={projects:[],isLoading:false,onOpen:()=>{},onCreate:()=>{},onEdit:()=>{},onDelete:async()=>true,openMenuId:null,onToggleMenu:()=>{}};
  const failed=render(ProjectPortfolio,{...props,error:'לא ניתן לטעון את הפרויקטים כרגע',onRetry:()=>{}});
  assert.ok(failed.includes('לא ניתן לטעון את הפרויקטים כרגע'));
  assert.ok(failed.includes('ניסיון נוסף'));
  assert.ok(!failed.includes('עדיין אין פרויקטים'));
  assert.ok(render(ProjectPortfolio,props).includes('עדיין אין פרויקטים'));
});

test('project form exposes persistent labels, the name error and a blocked in-flight save',()=>{
  let saves=0;
  const html=render(ProjectFormContent,{mode:'create',titleId:'create-title',values:{name:'',client_name:'',budget:0},pending:true,error:'Project name is required',onChange:()=>{},onSave:()=>saves++,onClose:()=>{}});
  for(const label of ['שם הפרויקט','שם הלקוח','נדרש שם פרויקט'])assert.ok(html.includes(label));
  assert.match(html,/aria-invalid="true"/u);
  assert.match(html,/<button[^>]*type="submit"[^>]*disabled/u);
  assert.equal(saves,0);
});

test('delete confirmation names the exact project, describes the consequences and does not delete on open',()=>{
  let deletes=0;
  const html=render(ProjectDeleteContent,{project:projects[0],pending:false,onConfirm:()=>deletes++,onClose:()=>{}});
  assert.ok(html.includes(projects[0].name));
  assert.ok(html.includes('כל הנתונים'));
  assert.ok(html.includes('ביטול'));
  assert.equal(deletes,0);
});

test('entry failure is a self-contained RTL page with a safe retry and no account form or secrets',()=>{
  const html=renderWorkspaceEntryError();
  assert.match(html,/<html[^>]*lang="he"[^>]*dir="rtl"/u);
  assert.ok(html.includes('לא ניתן לפתוח את המערכת כרגע. נסו לרענן את העמוד.'));
  assert.match(html,/<a[^>]*href="\/"/u);
  assert.doesNotMatch(html,/<script|<input|<form|SUPABASE|SERVICE_ROLE|API_KEY|password/iu);
});

test('unavailable surface gives recovery actions without calling them during rendering',()=>{
  let reads=0;
  const html=render(UnavailableView,{title:'המסך אינו זמין',message:'המידע לא נטען',onRetry:()=>reads++,onBack:()=>{}});
  assert.ok(html.includes('המידע לא נטען'));
  assert.ok(html.includes('ניסיון נוסף'));
  assert.ok(html.includes('חזרה לפרויקטים'));
  assert.equal(reads,0);
});
