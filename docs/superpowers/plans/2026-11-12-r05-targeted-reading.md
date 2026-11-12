# R05: точечное чтение — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Исполняет текущий помощник в текущем чате. Владелец запретил субагентов, дополнительных AI-рецензентов и создание нового дерева/ветки. Отмечать выполнение в отдельном журнале; одобренные байты этого плана сохранять.

**Goal:** ContractorSystem подтверждает спорные строки по увеличенному исходному фрагменту и сохраняет уже подтверждённое содержание, после чего проверяется весь оставшийся объём R05.

**Architecture:** Сохранённые исходные чтения остаются неизменными. К ним добавляются адресные доказательства: положение в исходнике, опознавательное окружение и два независимых ответа. Сервер проверяет составное подтверждение перед сохранением и повторным использованием; обычное действие чтения документа и существующий исполнитель AI сохраняются.

**Tech Stack:** TypeScript, Next.js, существующий `execution.generate`, Supabase `documents.parsed_json`, Node 24.22.1, закреплённые `pdf-lib`/`pdf-parse`/`sharp`/officeparser 8.4.1, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-r05-targeted-reading-design.md`, SHA256 `92c8e20762a69cd89eefa4b667d6d0663b520f2619f9d7aa45f82fa48a871bd4`. Одобрение проекта: сообщение владельца `01a1cfb4-1e5b-75a1-bc7c-a45b6b3bf213`, native-вопрос `call_71dda7a84fcd4494860d608ba1173067`. Старые условия: задача5 в `docs/superpowers/plans/2026-10-31-finish-r01-r12.md` и задача7 в плане визуального чтения от 2026-11-01.

## Global Constraints

- «За один проход одной исходной единицы предлагается проверять до четырёх отдельных областей, по два независимых чтения каждой». Фиксируем предел4 на единицу, один поиск координат за проход; автоматического цикла повторов нет.
- «Подтверждающее чтение получает изображение и проверяемое место, но не предыдущий предполагаемый ответ». Ни одна из двух проверок фрагмента не получает спорные варианты текста/чисел.
- «Существующие полные подтверждения и неизменённые успешные изображения остаются пригодными». Значения `visual-source-reading-v2` и `visual-reading-rules-v2` не повышать глобально ради новых фрагментов.
- «В той же parsed_json хранится добавочное доказательство; отдельные бизнес-таблицы и новый провайдер не требуются». Новые зависимости, модельные клиенты, смена модели/режима запрещены.
- «Эмблемы по-прежнему распознаются по общему виду; их мелкие надписи не возвращаются в обязательное чтение». Рабочее фото, условие, подпись согласования и чертёж сохраняют предметное значение.
- «Финансовые и ручные значения не меняются чтением». Не запускать анализ/радар, импорт, восстановление базы или Storage-запись вместо `read_source`.
- Корневая ветка `codex/recovery-audit-2026-09-07`; исходные28 изменений/8 защищённых файлов сохраняются, включая `AGENTS.md`. Только свои точные пути в `git add`.
- Исходный архив `C:/רייכשטט הנדסה/רייכשטט הנדסה/תבע מזרחית קרית גת` только для чтения. Три паузы `079e3bb2-d4f5-4a2e-89b3-c7d75571a28b`, `8739836c-cee3-48ad-ae3d-c4bc228fcb1c`, `936cc9dd-ff07-4c8d-b2f8-d2dbd0a00834` не возобновлять.
- Физическая установка находится в `C:/Users/97254/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/ContractorSystem`. Логические MSIX-пути в manifest не переписывать. Профиль владельца сохранять.

## Review Focus

1. Две одинаковые строки на странице: чужая строка с тем же числом не подтверждает нужную. Тест `duplicate_anchor_stays_partial` задачи1.
2. Поворот, CropBox и край страницы: координаты относятся к отображаемому оригиналу, подпись/единица/конец диапазона видимы. Тесты `rotated_fragment_keeps_context`, `clipped_context_stays_partial` задачи2.
3. Пятый спорный участок и отмена после первого подтверждения: прогресс сохраняется, подтверждённое не читается повторно, полная единица не заявляется. Тест `bounded_resume_keeps_first_proof` задачи3.
4. Старый текст/цитата и вручную утверждённый документ: новая сборка не подменяет старую версию и ручные поля. Тест `composed_reading_preserves_history_and_manual_fields` задачи3.
5. Чужой документ, изменённый исходник или подделанный адрес/хеш: изображение не выдаётся, доказательство не принимается. Тесты `fragment_proof_rejects_changed_binding` задачи1 и `fragment_route_rejects_foreign_scope` задачи4.

---

## Подтверждённая отправная точка

Планирование разрешено локальной проверкой workflow `construction/r05-targeted-reading-2026-11-12`. Продуктовый код ещё не изменён. Проверка `after-controls/manifest.json` от 12 ноября:181 документ,211 заданий,28 частичных документов (25 активных/3 паузы),20 таблиц сверены. Два обычных чтения сохранили partial0/2 и partial1/2; прежние полные единицы, старый текст, остальные деловые данные и1884 исходных файла сохранены. Работает прежняя v53, BUILD `fRUBlqWDC11ekGoBFxL7a`, порт3002; перед исполнением сверить живой процесс заново.

## Границы файлов и интерфейсов

Новые файлы имеют по одной обязанности:

- `src/utils/visual-fragment-contracts.ts`: общие типы, строгие схемы ответов и структурное сопоставление строк. Без Node/файловой системы, пригоден клиенту.
- `src/server/ai/visual-fragment-proof.server.ts`: хеши, проверка происхождения и сборка буквального результата.
- `src/server/ai/visual-fragment-reader.server.ts`: поиск координат, два слепых чтения, предел4; только существующий `AiExecutionContext`.
- `src/server/documents/visual-fragment-renderer.server.ts`: получение фрагмента оригинального PDF/изображения, включая поддержанную часть MSG.
- `src/components/documents/DocumentReadingFragments.tsx`: просмотр подтверждений и оставшихся мест через обычный источник документа.
- `src/app/api/documents/reading/fragment/route.ts`: выдача сохранённого исходного фрагмента после проверки доступа и версии, без AI/записей.

Контракты, которые определяются задачей1 и используются далее:

```ts
type FragmentAddress = {kind:'line';line:number}|{kind:'table-row';table:number;row:number}; // индексы с0
type FragmentValue = string|string[]; // строка текста либо все ячейки строки таблицы, включая пустые
type FragmentAnchor = {id:string;address:FragmentAddress;value:FragmentValue};
type FragmentTarget = {id:string;unitId:string;viewIds:string[];address:FragmentAddress;anchors:FragmentAnchor[];reason:string};
type FragmentPlan = {targets:FragmentTarget[];issues:string[]};
type FragmentResponse = {targetId:string;blocks:Array<{id:string;value:FragmentValue}>;uncertainties:string[]};
type FragmentProof = {
  version:'visual-fragment-proof-v1';scope:ReadingScope;unitId:string;inputHash:string;
  baseEvidenceHash:string;target:FragmentTarget;rect:Rect;
  image:Omit<RenderedView,'bytes'>;raw:[string,string];readings:[FragmentResponse,FragmentResponse];
  value:FragmentValue;createdBy:{jobId:string;profileRevision:number};
};
type FragmentComposition = {version:'visual-fragment-assembly-v1';baseEvidenceHash:string;proofs:FragmentProof[];pending:FragmentTarget[];issues:string[]};
type FragmentRenderer = (unit:ReadingUnit,rect:Rect)=>Promise<RenderedView|null>;
```

`VerifiedUnit.composition?:FragmentComposition` добавляется без замены `views[].reading/confirmation/initialReading`. `baseEvidenceHash` — SHA256 канонического JSON исходного массива `views`, без его изменения; отдельные доказательства содержат фактические job/profile revision. Реестр получает краткое `composition` с версиями, ссылками на цели/изображения, числом подтверждённых/ожидающих областей и хешем полного доказательства; сырой ответ остаётся в `source_reading_units`/истории. Краткая сводка сама по себе не заменяет серверную проверку.

Сопоставление допускает точные адреса только при одинаковой структуре двух чтений: число строк текста и таблиц/строк/ячеек совпадает. Сохраняются пустые ячейки и порядок. Используется существующая `normalizeReadingTypography`, без удаления слов, перестановки обозначений или округления. Для цели требуются минимум два различных опознавательных блока, совпавших в исходных чтениях и однозначных в соответствующем окружении. В независимых ответах они должны присутствовать в правильном порядке вместе с полной целевой строкой. При нехватке/повторяемости окружения, сдвиге структуры, непривязанной uncertainty или неоднозначном описании изображения сохраняется конкретное ограничение. Не пытаться восстановить такую страницу подбором большинства ответов.

## Проверочная среда исполнения

В задаче1 создать частный `.superpowers/r05-finish-20261112/verify.mjs`, адаптируя проверенный `.superpowers/r05-visual-reading-2026-11-01/verify.mjs`: новый `test-source`, новый журнал, SHA этого одобренного плана, физический путь сохранённых зависимостей `dependencies/f00974a5ac7f1266678bff8f/node_modules`. Старые журналы не перезаписывать. Сверять lock/версии, хеши всех скопированных входов до/после; не копировать `.env`/реальные документы, использовать существующие синтетические тесты. Рабочий `node_modules` с officeparser7.2.3 не является средой приёмки.

Во всех командах ниже `$r05Node` означает проверенный существующий физический `runtime/node-b59feb2088f80e1f.exe` (SHA256 `b59feb2088f80e1fa431c8f9c316861e660e5936f968fd97b802e550fed356c5`), `$r05Verify` — абсолютный путь нового частного `verify.mjs`. Режимы `test`, `tsc`, `documents`, `ssr`, `lint`, `script` сохраняют семантику старого помощника. Для RED записывать конкретное проваленное утверждение; ошибка импорта/неверная среда не доказывает нужного дефекта. Для GREEN: exit0, все новые утверждения выполнены, входы неизменны. Перед каждым сохранением задачи — также TypeScript, профильный набор, production-сборка и проверка приложения после входа; если установленные входы ещё прежние, явно различать проверку работающей v53 и проверку нового кандидата.

### Задача1. Адрес разногласия и проверяемая сборка

**Files:** создать `src/utils/visual-fragment-contracts.ts`, `src/server/ai/visual-fragment-proof.server.ts`, `scripts/verify-visual-fragment-contracts.mjs`; изменить `src/utils/visual-source-reading.ts` только для добавочных типов. Фикстуры — `scripts/codex-runtime/visual-reading-fixtures.mjs`.

**Interfaces:** потребляет существующие `UnitReading`, `VerifiedUnit`, `ReadingUnit`, `ReadingScope`, `Rect`, `normalizeReadingTypography`. Производит типы выше и:

```ts
planFragmentTargets(unit:ReadingUnit,saved:VerifiedUnit):FragmentPlan;
verifyFragmentProof(value:unknown,scope:ReadingScope,unit:ReadingUnit,base:VerifiedUnit,target:FragmentTarget,image:RenderedView):FragmentProof|null;
composeFragmentReading(unit:ReadingUnit,base:VerifiedUnit,proofs:FragmentProof[],scope:ReadingScope):VerifiedUnit;
```

- [ ] **1. RED-тесты.** `localized_row_keeps_approximation_and_labels`: для двух таблиц с одинаковой структурой, отличающихся `כ570`/`570` в строке3, `assert.deepEqual(plan.targets.map(t=>t.address),[{kind:'table-row',table:0,row:3}])`; несовпадающие слова `כ`, отрицание, дата и W74–W116/W116–W74 не становятся равными. `duplicate_anchor_stays_partial`: повторяющееся окружение даёт `assert.equal(plan.targets.length,0); assert.ok(plan.issues.length)`. `fragment_proof_rejects_changed_binding`: по одному изменить scope/sourceHash/inputHash/baseEvidenceHash/address/rect/imageHash/raw/value; каждый вариант даёт `assert.equal(accepted,null)`. `literal_composition_keeps_raw_base`: `assert.deepEqual(result.views,base.views)` и точная замена только целевой строки; без хотя бы одного нужного доказательства `assert.equal(result.complete,false)`.
- [ ] **2. Наблюдать RED.** `& $r05Node $r05Verify test scripts/verify-visual-fragment-contracts.mjs`; сохранить журнал с ожидаемым отсутствующим контрактом/неверным результатом, без AI.
- [ ] **3. Реализовать указанные контракты.** Новая сборка явно хранит `composition`, пересчитывает буквальный текст/таблицы и textHash. Все разногласия всех исходных представлений либо закрыты проверенными адресными фрагментами, либо остаются в pending/issues. Непривязанные uncertainties/неполное покрытие/нужные native-ограничения не удаляются. Локатор и сообщение модели «всё верно» не являются основанием полноты.
- [ ] **4. GREEN.** Повторить новый набор вместе с `scripts/verify-visual-source-contracts.mjs`; проверить также пустые ячейки, перестановку столбцов/формы таблицы, разные единицы измерения и два согласных ответа от другой строки — каждый остаётся partial. Только допустимая типографика проходит без изменения исходных raw.
- [ ] **5. Проверить и сохранить задачу.** Выполнить проверки среды выше, авторскую проверку интерфейсов и только затем точный `git add` своих файлов, `git commit -m "feat: verify addressed source fragment evidence"`; отправить в существующую ветку. Журнал выполнения отдельно, одобренные документы не менять.

### Задача2. Физическое увеличение и два независимых чтения

**Files:** создать `src/server/documents/visual-fragment-renderer.server.ts`, `src/server/ai/visual-fragment-reader.server.ts`, `scripts/verify-visual-fragment-renderer.mjs`, `scripts/verify-visual-fragment-reader.mjs`; изменить `src/utils/visual-pdf-renderer.ts` добавочным параметром качества; добавить синтетические изображения/повороты в общие фикстуры.

**Interfaces:** потребляет задачу1 и существующий `execution.generate/checkActive`, `renderPdfView`, `readMsgContainer`. Производит:

```ts
createSourceFragmentRenderer(file:Buffer,title:string,manifest:SourceManifest):FragmentRenderer;
renderPdfView(file:Buffer,page:number,rect:Rect|undefined,options?:{detail:'fragment'}):Promise<RenderedView>;
readTargetedFragments(args:{unit:ReadingUnit;saved:VerifiedUnit;scope:ReadingScope;execution:AiExecutionContext;render:FragmentRenderer;onCheckpoint:(value:VerifiedUnit)=>Promise<void>}):Promise<VerifiedUnit>;
```

- [ ] **1. RED-тесты.** `rotated_fragment_keeps_context`: синтетические PDF с поворотом0/90/180/270, ненулевым CropBox, цветной целевой строкой и подписанными соседями; по пикселям/геометрии проверить правильный участок, `assert.ok(image.width*image.height<=16_000_000)`, исходные байты прежние. `clipped_context_stays_partial`: без подписи/единицы/конца диапазона или нужного опознавательного блока `assert.equal(result.complete,false)`. `confirmation_is_blind`: обе проверки получают изображение/адрес/согласованные опознавательные блоки; `assert.ok(!prompt.includes('כ570')); assert.ok(!prompt.includes('570'))` для вариантов целевого ответа, а second input не содержит first raw. `locator_is_not_a_reading`: уверенные координаты без двух читаемых совпадающих ответов не дают proof.
- [ ] **2. Наблюдать RED.** `& $r05Node $r05Verify test scripts/verify-visual-fragment-renderer.mjs scripts/verify-visual-fragment-reader.mjs`; сохранить ожидаемые провалы.
- [ ] **3. Реализовать увеличение.** Сохранить прежний рендер по умолчанию; `detail:'fragment'` с обязательным rect использует600dpi при прежнем ограничении16_000_000 пикселей/размеров. Включить качество в новый ID, размеры и SHA в доказательство. Для изображения использовать самый подробный исходный вид, содержащий всю область, `sharp.extract` с преобразованием координат и ограниченным увеличением; при отсутствии достаточного оригинала вернуть null. PDF внутри MSG разрешать только через физически найденный payload нужной части/страницы и его хеш; иной/неподдержанный объект не выдавать за PDF.
- [ ] **4. Реализовать чтение.** Один структурированный поиск координат на единицу при отсутствии пригодной native-геометрии; он получает разногласия только для поиска. Проверить конечность координат, область оригинала, принадлежность цели и требуемое окружение. Отобрать первые4 ещё неподтверждённые области в порядке исходника. Каждую прочитать дважды слепо через `execution.generate`, строгую `FragmentResponse` и существующие приватные job-файлы; сверить весь целевой блок и окружающие блоки. После каждого принятого доказательства вызвать `onCheckpoint`; проверять отмену до/после обращений и записи. При неоднозначности сохранить конкретную причину. Ни повторов локатора, ни автоматического перехода к полной странице в том же проходе.
- [ ] **5. GREEN.** Повторить оба набора и `scripts/verify-visual-source-manifest.mjs`. Проверить NaN/выход за границы/пустой crop/несовпадающие даты/коды/исправленный по памяти ответ/поддельный targetId. При сохранённой исходной паре максимум1 locator+8 fragment-calls на единицу; raw каждого вызова сохранён в доказательствах. Два согласных чтения с правильным контекстом закрывают только свои адреса.
- [ ] **6. Проверить и сохранить.** Проверки среды/production/работающее приложение, авторская проверка защиты пути; точный коммит `feat: reread enlarged source fragments with independent checks` и отправка в прежнюю ветку.

### Задача3. Продолжение с сохранённого результата, совместимость и история

**Files:** изменить `src/server/ai/visual-source-reader.server.ts`, `src/server/ai/visual-reading-cache.server.ts`, `src/server/ai/handlers/document-reading.ts`, `src/utils/document-reading-history.ts`, `src/utils/visual-source-reading.ts`; дополнить `scripts/verify-visual-source-reader.mjs`, `scripts/verify-visual-reading-cache.mjs`, `scripts/verify-document-reading-flow.mjs`, `scripts/verify-document-reading-history.mjs`, `scripts/verify-document-reading-job.mjs`, `scripts/verify-document-runtime.mjs`.

**Interfaces:** потребляет задачи1–2. Добавляет четвёртый необязательный параметр к существующему читателю:

```ts
type VisualReadOptions = {retainedUnits?:VerifiedUnit[];renderFragment?:FragmentRenderer};
readVisualSource(manifest:SourceManifest,scope:ReadingScope,execution:AiExecutionContext,options?:VisualReadOptions):Promise<{units:VerifiedUnit[];issues:string[]}>;
verifiedReadingUnit(value:unknown,unit:ReadingUnit,scope?:ReadingScope):boolean;
assembleDocumentReading(manifest:SourceManifest,units:VerifiedUnit[],scope?:ReadingScope):ReadingAssembly;
```

Существующий `createVisualReadingCache(root)` дополнительно предоставляет `readProgress(scope:ReadingScope,unit:ReadingUnit):Promise<VerifiedUnit|null>` и `writeProgress(scope:ReadingScope,unit:ReadingUnit,value:VerifiedUnit):Promise<void>`. Новый составной результат требует scope и полной серверной проверки; старые вызовы/полные доказательства без composition сохраняют прежнюю семантику.

- [ ] **1. RED-тесты.** `retained_mismatch_uses_only_fragments`: сохранённая проверяемая исходная пара не порождает полного reread, `assert.equal(fullPageCalls,0)`. `bounded_resume_keeps_first_proof`:5 целей, первый проход подтверждает4, `assert.equal(first.complete,false); assert.equal(first.composition.pending.length,1)`; при отмене после первого checkpoint и новом job первый proof прежний и не отправлен заново. `composed_reading_preserves_history_and_manual_fields`: старый textHash/цитата открываются с точным прежним текстом; `ai_status:'VALIDATED'`, category, owner_note, financial_data, прежние полные units и их raw равны исходным. `changed_source_cannot_reuse_fragment`: другой scope/байты/адрес/хеш не проходят проверку и не дают complete. `damaged_composition_cannot_take_complete_fast_path`: при complete в кратком реестре, повреждённом raw в полном proof и пустом отдельном cache `assert.equal(result.cached,false); assert.equal(result.reading.verification.complete,false)`. Старый тест двух попыток сохранить для случая без надёжной привязки/доступного renderer.
- [ ] **2. Наблюдать RED.** `& $r05Node $r05Verify test scripts/verify-visual-source-reader.mjs scripts/verify-visual-reading-cache.mjs scripts/verify-document-reading-flow.mjs scripts/verify-document-reading-history.mjs scripts/verify-document-reading-job.mjs`; записать конкретные новые провалы, прежние проверки не ослаблять.
- [ ] **3. Подключить продолжение.** `stageDocumentReading` передаёт валидированные сохранённые partial units и `createSourceFragmentRenderer`; успешные прежние units обслуживает cache. Сначала использовать совпадающую исходную пару/сохранённый прогресс; если их нет, выполнить обычное начальное чтение, затем разрешённые адресные попытки. Прогресс-файлы сохранять атомарно в проверенной scope-директории существующего cache, без symlink/path escape. Объединять прогресс только при одинаковом baseEvidenceHash; другой базовый ответ не заменяет молча сохранённые фрагменты.
- [ ] **4. Подключить подтверждение и сохранение.** Ветка composition отдельно перепроверяет raw, хеши, адреса/контекст/результат, полноту всех исходных областей; не изменяет старые `VerifiedView` для прохождения legacy-проверки. Для составного чтения эта проверка обязательна также ДО раннего cached-возврата в `stageDocumentReading`: одного `assessVisualReading` по краткому реестру недостаточно; восстановить manifest из уже загруженного исходника и проверить полные units со scope, без AI. Краткий реестр отражает pending и подтверждённые области, completedUnits по-прежнему считает полные единицы. `createReadingPatch` сохраняет прежний полный текст/хеш/историю и все ручные поля. При отмене не записывать новое успешное состояние в documents; подтверждённые checkpoint доступны следующему обычному чтению. Несовместимое/повреждённое доказательство остаётся partial; отсутствие renderer не запускает скрытый общий reread.
- [ ] **5. GREEN.** Повторить профильный набор, затем `& $r05Node $r05Verify documents`. Регрессии: неизменённое старое полное подтверждение даёт0AI; второй запуск нового полного подтверждения даёт0AI; MSG/native-ограничения и непривязанные uncertainty сохраняются; сырые исходные ответы неизменны; поздний сбой не удаляет рабочее чтение. Добавить новые три набора задач1–2 в `scripts/verify-document-runtime.mjs` и наблюдать их фактический запуск.
- [ ] **6. Проверить и сохранить.** TypeScript/профиль/production/UI по правилам среды, точный коммит `feat: resume verified fragment reading without losing source history`, отправка в прежнюю ветку.

### Задача4. Открытие фрагмента и понятный остаток в интерфейсе

**Files:** создать `src/app/api/documents/reading/fragment/route.ts`, `src/components/documents/DocumentReadingFragments.tsx`, `scripts/verify-document-reading-fragments.mjs`; изменить `src/app/api/documents/reading/route.ts`, `src/components/documents/DocumentSourceView.tsx`, `src/components/documents/documentAiApi.ts`, `scripts/verify-document-runtime.mjs`; при необходимости передать уже существующую версию из `src/components/documents/ScreenOfTruthModal.tsx`, без нового навигационного потока.

**Interfaces:** `GET /api/documents/reading/fragment?projectId&documentId&sourceHash&textHash&unitId&targetId` возвращает `image/png`, `private,no-store`, `nosniff`. Координаты/пути/URL клиент не задаёт; область только из сохранённого проверенного proof. Ошибки400 неверный запрос,403 чужой проект,404 отсутствующая версия/цель,409 изменённый исходник,422 неподтверждённое/повреждённое доказательство. Исторические units извлекать из найденной версии истории, а не из текущего массива. Компонент получает `{documentId:string;projectId:string;sourceHash:string;textHash:string;units:VerifiedUnit[]}`; только просмотр и существующее действие продолжения чтения.

- [ ] **1. RED-тесты.** `fragment_route_rejects_foreign_scope`:403 без рендера/AI/записей; другой sourceHash409; подмена textHash/targetId404; испорченный proof422. `fragment_ui_keeps_partial_visible`: подтверждено4/5 фрагментов и0/1 полных страниц — показано неполное чтение, есть конкретный остаток/обычное продолжение. `historical_fragment_uses_historical_proof`: старая версия открывает свой raw/proof и оригинал, текущий результат прежний. Проверить, что открытие изображения/деталей даёт `assert.equal(modelCalls,0); assert.equal(writes,0)`.
- [ ] **2. Наблюдать RED.** `& $r05Node $r05Verify test scripts/verify-document-reading-fragments.mjs`; сохранить отказ нужного контракта.
- [ ] **3. Реализовать просмотр.** Использовать `requireOwnedProject/requireOwnedDocument`, `resolveReadingVersion`, `downloadDocumentBuffer` и серверную проверку proof с восстановлением исходной области. Пересчитать SHA выдаваемого crop; несовпадение не скрывать новым изображением. `reading/route.ts` возвращает units соответствующей исторической версии. В UI показывать страницу/часть, состояние строки, её подтверждённый текст либо причину остатка, увеличенное изображение и раскрываемые два исходных ответа. Текст интерфейса — в существующем иврите, без служебных кодов/хешей в основном действии. Эмблемы не создают новый остаток из мелкого шрифта. Успешное задание не скрывает partial; ошибка просмотра не запускает чтение.
- [ ] **4. GREEN.** Новый набор, `scripts/verify-document-reading-history.mjs`, `scripts/verify-document-source-actions.mjs`, `scripts/redesign/verify-documents.mjs`; TypeScript. Регистрация нового набора в документах проверяет и разрешённый доступ к реальному сгенерированному фрагменту, и отрицательные случаи. Обхода по URL/произвольному rect нет.
- [ ] **5. Проверить и сохранить.** Production и приложение после входа, обычные источники/история/клавиатура/RTL; точный коммит `feat: show addressed reading evidence and remaining fragments`, отправка в прежнюю ветку.

### Задача5. Поставка, реальные документы и проверка всех условий R05

**Files:** частные помощники/квитанции только `.superpowers/r05-finish-20261112/`; существующие `scripts/local-system-package.mjs`, `scripts/local-system-launch.mjs` использовать без переделки установки. Обезличенный отчёт — `docs/R05_VISUAL_READING_DELIVERY_RU.md`; текущее состояние — `docs/HANDOFF_CURRENT_RU.md`, `_project/state.md`, `_project/registers/evidence.md`, `_project/registers/decisions.md`. Прогресс/checklist этапа обновлять отдельно от одобренных спецификаций/планов; условия не переписывать.

**Interfaces:** потребляет все предыдущие задачи и их свежие проверки. Производит установленный выпуск, точные исходы job/сохранённого чтения/интерфейса и матрицу исходных условий R05; число успешных задач само по себе не считается полнотой документов.

- [ ] **1. Завершить проверки.** Запустить `& $r05Node $r05Verify tsc`, `documents`, `script verify:financials`, `ssr`, `lint`; остальные существующие CI-профили — только реально затронутые зависимости/новый отказ. Новые наборы включены в `verify:documents`; если job-прогресс затронул SQL-контракт, существующие проверки jobs запускать только в изолированной тестовой PostgreSQL. Production собрать в новом частном каталоге с закреплёнными зависимостями, адаптируя проверенный `.superpowers/r08-protocol-batch-20261112/implementation/.superpowers/package-build.mjs`; сохранить входные/выходные хеши и build-checks. Отсутствие нового изменения/риска не является причиной повторять уже успешные наборы.
- [ ] **2. Подготовить поставку.** Перед бизнес-прогоном сохранить/сверить20 таблиц и существующий полный backup Storage, подтвердить нулевую активную очередь,1884 исходных файла/3 паузы/ручные поля/защищённые изменения/профиль. Выбрать свободный новый release ID, сохранить v53 для возврата. Штатно упаковать проверенную сборку через `local-system-package.mjs`, проверить кандидата на3007 после входа, остановить кандидат, установить/запустить через существующий launcher. Для MSIX использовать проверенный физический Node с обратными слешами, не повторять отсутствующий логический путь из окна ошибки. Проверить файлы поставки, Node, BUILD, вход и основные экраны на3002. При неудаче вернуть рабочую v53 прежде дальнейших изменений.
- [ ] **3. Провести первый реальный контроль.** Через обычный `read_source` сначала `aa281874-4957-4cbf-a5a3-3b09e7e39e57` (`אבני דרך.pdf`), затем `b8ba964e-4f44-4a75-8a8f-fa82179b00da`. Не повторять уже терминальные job08a49687/9871e2d9; новый job относится к новой версии механизма. Измерить новые полные/фрагментные вызовы, elapsed и фактически доступный расход без выдуманных оценок. Проверить правильную физическую строку/окружение, сохранность старой полной единицы и цитат. Через интерфейс открыть фрагмент, оба ответа, полный текст, старую версию и повторное открытие без AI. Если контроль не доказывает привязку или теряет соседние строки — исправить в одобренных границах, перепроверить относящееся и лишь затем продолжить.
- [ ] **4. Завершить конечный проход.** По исходному реестру25 активных ограничений выбрать только поддержанные визуальные остатки; использовать старые полные units и сохранённые fragment proofs. Один ограниченный проход на остаток, последующее продолжение — только по точному pending без полного reread.3 паузы сохраняются. Для DOCX/MSG не убирать native/альтернативное тело/ZIP-CAD-ограничения от успеха соседней картинки. Реальный Word/растровый/XLSX путь проверить по изменённому механизму без импорта дублей; прежние успешные исходники не читать моделью заново. Сопоставить1884 исходных файла с текущими181 записями по происхождению/содержимому/назначению, используя существующий аудит и реестры; увеличившееся с173 число записей объяснить сохранёнными intake-событиями. Нужный материал без доказанного происхождения/чтения остаётся открытым пунктом.
- [ ] **5. Сверить результат и записать статус.** Полная сверка20 таблиц допускает только чтение выбранных документов и собственные новые `project_ai_jobs`; прочие деловые/финансовые данные, прежние задания,1884 оригинала/3 паузы/профиль прежние. Проверить нормальное открытие после установки и восстановление сохранённого прогресса после синтетического сбоя. Обновить Graphify локально только по изменённому коду с сохранением старых не-AST узлов. В матрице R05 для каждого прежнего условия указать доказательство и остаток: происхождение/необходимый состав, чтение/покрытие, пригодность редакции, реальные PDF/DOCX/XLSX, отрицательные случаи, рабочая поставка, сохранность. Полный R05 только при выполнении всех условий; неподдержанное содержание не отмечать прочитанным. Новая необходимость другого механизма предъявляется отдельно, без ложного закрытия этапа.
- [ ] **6. Сохранить проверенную поставку.** Авторское ревью diff/приёмки, точные коммиты своих файлов, push в существующую ветку, наблюдать относящийся GitHub CI до результата. Не публиковать настоящие документы/сырой текст/снимки базы/секреты. В отчёте/HANDOFF записать реальный SHA/release/BUILD/адрес, результаты/пределы проверок, фактический статус R05 и один следующий шаг. Общие R08/полная R07 этим механизмом не закрываются.

## Самопроверка и переход к исполнению

Покрытие проекта: поведение/принадлежность/числа/сборка → задачи1–2; прогресс/история/совместимость/данные → задача3; просмотр и явный остаток → задача4; реальные контроли/конечность/весь R05 → задача5. Все пять Review Focus привязаны к отрицательным тестам. Producer/consumer используют одинаковые типы и названия; старые трёхаргументные вызовы и полные доказательства сохранены. Отдельных бизнес-таблиц, импортов и новых AI-клиентов нет. Рендер600dpi и правило двух опознавательных блоков — конкретные технические решения этого плана, не приписанные ранее владельцу.

Самопроверка выполнена автором; независимого AI-ревью нет по ограничению владельца. После предъявления этого плана требуется действительное подтверждение его проверки, затем workflow `--next implementation`. Одобрение проекта от12 ноября не заменяет одобрение ещё не показанного плана. Метод выполнения уже выбран: самостоятельно, в этом чате, без дополнительных исполнителей. Прогресс и новые факты писать в `.superpowers/r05-finish-20261112/LEDGER_RU.md`, одобренные байты плана/spec не менять.

## Judge audit — 2026-11-12

Авторская проверка: исполнитель всех задач — текущий помощник; зависимости1→2→3→4→5 и свидетельства приёмки указаны. Срок/бюджет/процент готовности не оценивались и не обещаны. Исходные условия R05 сохранены. Числа отправной точки взяты из `after-controls/manifest.json`, согласования — из реальных сообщений владельца.

Найденный риск: ранний cached-возврат мог бы довериться краткому реестру при испорченном полном составном доказательстве. В задачу3 добавлены обязательная серверная перепроверка до этого возврата и отрицательный тест `damaged_composition_cannot_take_complete_fast_path`. Остаточный риск: не всякий исходник имеет однозначные опознавательные блоки; такой источник остаётся partial, а реальная пригодность механизма проверяется задачей5. План готов для проверки владельцем, реализация ещё не разрешена.
