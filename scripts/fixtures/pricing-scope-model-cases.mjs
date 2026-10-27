// Synthetic acceptance properties fixed before inference; not a real-project accuracy score.
const policy='לצורך בדיקה זו אושר מחירון בדיקה א כמקור לתמחור העבודות. התשלום הוא לפי מחיר היחידה בסעיף לפני מע"מ, ללא הנחות, תוספות או מקדמים נוספים.';
const baseWork='יש לבצע אספקה ופיזור של 2 מ"ק חומר מילוי גרגירי מסוג C ללא צמנט.';
const basePrice='אספקה ופיזור חומר מילוי גרגירי מסוג C ללא צמנט. יחידה מ"ק. מחיר 75 ש"ח ללא מע"מ.';
function context(work=baseWork,prices=[{id:'test-fill-a',text:basePrice,unit:'מ"ק',rate:75,code:'TEST-FILL-A'}],contract=policy){
 return{query:work,workSourceIds:['work'],sources:[{id:'work',title:'הוראת בדיקה',role:'WORK',allowed:true,extracted_text:work},
  ...prices.map(price=>({id:price.id,title:'מחירון בדיקה א',role:'PRICE',allowed:true,extracted_text:`${price.code}\n${price.text}`})),
  ...(contract?[{id:'contract',title:'תנאי תמחור הבדיקה',role:'CONTRACT',allowed:true,extracted_text:contract}]:[])],
  candidates:prices.map(price=>({id:price.id,sourceId:price.id,title:'מחירון בדיקה א',text:`${price.code}\n${price.text}`,itemCode:price.code,unit:price.unit,rate:price.rate,noteSourceIds:[],priceBasis:'EXCL_VAT'}))};
}
const supply={id:'test-supply',code:'TEST-SUPPLY',text:'אספקת שסתומים בלבד. התקנת השסתומים אינה כלולה. יחידה יחידה. מחיר 60 ש"ח ללא מע"מ.',unit:'יחידה',rate:60};
const install={id:'test-install',code:'TEST-INSTALL',text:'התקנת שסתומים שסופקו בנפרד בלבד. האספקה אינה כלולה. יחידה יחידה. מחיר 15 ש"ח ללא מע"מ.',unit:'יחידה',rate:15};
const valveWork='יש לבצע אספקה והתקנה של 2 שסתומים. יחידת מדידה: יחידה.';
export const pricingModelCases=[
 {id:'event-is-not-new-work',basis:'A stoppage report does not request eruv construction.',context:context('תועדה עצירה בעבודות הנחת צינורות מים ואביזרים.',[{id:'test-eruv',code:'TEST-ERUV',text:'הקמת עירוב מצינורות מתכת מגולוונים. יחידה מטר. מחיר 19 ש"ח ללא מע"מ.',unit:'מטר',rate:19}]),status:'REJECTED',total:null},
 {id:'explicit-conflicting-composition',basis:'The request explicitly requires 8% cement; the offered fill explicitly has no cement.',context:context('יש לבצע אספקה ופיזור של 2 מ"ק חול מיוצב בתוספת 8% צמנט מסוג S-8.'),status:'REJECTED',total:null},
 {id:'matching-approved-fill',basis:'Matching actions, material and m3; explicit source permission; 2 at 75 is 150.',context:context(),status:'FULL',total:150,actions:['אספקה','פיזור'],lines:1},
 {id:'supply-leaves-installation',basis:'Installation is requested and expressly excluded by this supply-only rate.',context:context(valveWork,[supply]),status:'PARTIAL',total:null,actions:['אספקה','התקנה'],uncovered:'התקנה'},
 {id:'two-part-prices-cover-work',basis:'Supply at 60 plus installation at 15 for 2 valves totals 150 without a repeated operation.',context:context(valveWork,[supply,install]),status:'FULL',total:150,actions:['אספקה','התקנה'],lines:2},
 {id:'compaction-already-included',basis:'One rate explicitly covers the three requested actions. Total 150 without an extra compaction line.',context:context('יש לבצע אספקה, פיזור והידוק של 2 מ"ק חומר מילוי גרגירי מסוג C ללא צמנט.',[{id:'test-complete-fill',code:'TEST-COMPLETE-FILL',text:'אספקה ופיזור של חומר מילוי גרגירי מסוג C ללא צמנט, לרבות הידוק. יחידה מ"ק. מחיר 75 ש"ח ללא מע"מ.',unit:'מ"ק',rate:75}]),status:'FULL',total:150,actions:['אספקה','פיזור','הידוק'],lines:1},
 {id:'no-pricing-permission',basis:'Physical similarity is insufficient without the applicable pricing permission.',context:context(baseWork,undefined,null),status:'NEEDS_REVIEW',total:null},
 {id:'contract-excludes-source',basis:'A supplied contract rule expressly excludes this price book.',context:context(baseWork,undefined,'מחירון בדיקה א אינו מקור מאושר לתמחור לפי חוזה בדיקה זה. אין לאשר מחיר אוטומטי לפי ספר זה.'),status:'REJECTED',total:null},
 {id:'opaque-locator-variant',basis:'A consistently changed fictional locator does not change otherwise identical work and source permission.',context:context(baseWork,[{id:'test-other-locator',code:'OPAQUE-Z9',text:basePrice,unit:'מ"ק',rate:75}]),status:'FULL',total:150,actions:['אספקה','פיזור'],lines:1},
 {id:'missing-measured-quantity',basis:'No measured quantity is supplied; a unit rate cannot create quantity one.',context:context('יש לבצע אספקה ופיזור חומר מילוי גרגירי מסוג C ללא צמנט. הכמות טרם נמדדה.'),status:'NEEDS_REVIEW',total:null},
 {id:'undefined-different-grades',basis:'No definitions establish equivalence or contradiction between two otherwise unspecified material grades.',context:context('יש לבצע אספקה ופיזור של 2 מ"ק חומר מילוי מסוג S8.',[{id:'test-undefined-grade',code:'TEST-UNDEFINED',text:'אספקה ופיזור חומר מילוי מסוג C. יחידה מ"ק. מחיר 75 ש"ח ללא מע"מ.',unit:'מ"ק',rate:75}]),status:'NEEDS_REVIEW',total:null},
 {id:'heldout-cleaning-painting',basis:'New actions and area: 3 m2 of cleaning and painting at 25 totals 75; source is expressly permitted.',context:context('יש לבצע ניקוי וצביעה של 3 מ"ר קיר.',[{id:'test-paint',code:'OPAQUE-PAINT',text:'ניקוי וצביעה של קירות. יחידה מ"ר. מחיר 25 ש"ח ללא מע"מ.',unit:'מ"ר',rate:25}]),status:'FULL',total:75,actions:['ניקוי','צביעה'],lines:1},
];
