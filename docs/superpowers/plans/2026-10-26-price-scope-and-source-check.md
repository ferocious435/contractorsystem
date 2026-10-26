# Проверка расценки и состава работ — план реализации

> Исполнение: самостоятельно в текущем чате через `superpowers:executing-plans`, без дополнительных исполнителей. Отметки ниже заполняются по факту проверки.

**Цель:** подходящая расценка покрывает требуемую работу; недостающие работы добавляются с доказательствами, без повторной оплаты.

**Архитектура:** существующая локальная обработка определяет смысл работы и состав позиции. Общий проверяющий код связывает вывод с настоящими источниками, проверяет числа и покрытие; его используют рекомендации радара и отдельный расчёт. Неизвестное остаётся неизвестным.

**Стек:** существующие TypeScript, Next.js, Supabase, Ollama и `node:test`; без новых зависимостей и миграций.

**Проект:** [утверждённое решение](../specs/2026-10-26-price-scope-and-source-check-design.md).

**Статус:** решение утверждено владельцем 26 октября; этот план подготовлен для просмотра, реализация не начата.

## Общие ограничения

- Синяя книга и 3210 применяются по умолчанию, если договором не установлено иное. Договорный механизм определяет допустимые ценовые источники; статический порядок прайс-листов его не заменяет.
- Суммы сохраняются без НДС. Цена, количество и коэффициенты имеют источник либо явную ручную отметку. Неподтверждённый результат остаётся на проверке; отсутствие количества не означает «1».
- Непрочитанный документ, неизвестный пункт или редакция не становятся пригодными из-за общей основы. Ограничение относится к зависящему от него выводу. Разные редакции разных глав допустимы.
- Принятые расчёты, история, технические исключения и прежние изменения владельца сохраняются. Кэш не сбрасывается ради новых модельных вызовов; общего скана, OCR и повторного анализа неизменённых документов нет.
- Использовать текущую настройку локальной обработки. При её недоступности сообщать об ограничении; внешнего запасного обработчика нет. Модель и режим не менять, дополнительные AI-клиенты не запускать.
- Папку израильских стандартов не читать и не подключать. Вопрос необходимости этой функции остаётся в итоговом аудите.
- Задачи 1–4 составляют один ограниченный выпуск. Сохранение реализации в GitHub и объявление этапа завершённым — после всей проверки задачи 5.
- До задачи 1 снять свежие контрольные хеши прежних 14 файлов владельца и 13 секций данных по составу `data/point1-audit/point14-default-preservation-20261025.json`. Старые хеши не заменяют свежую исходную проверку; полные тексты и секреты остаются локально.

## Фокус проверки

1. Ценовая выдержка или сообщение об остановке работ не создают самостоятельного требования выполнить работу — задачи 1–3.
2. Примечание из соседнего раздела, другой книги или непроверенного фрагмента не меняет состав цены — задачи 1–2.
3. Две частичные позиции могут покрыть работу вместе; уже включённая операция повторно не оплачивается — задачи 1–3.
4. Пропущенное количество, подменённая цена и коэффициент без основания не становятся готовой суммой; ручное количество не исправляет неподходящий материал — задачи 1 и 4.
5. Техническое исключение, старый кэш и недоступная локальная обработка не вызывают обход через другой обработчик или запись новых финансов — задачи 2–4.

## Файлы и ответственность

- Новые `src/utils/pricing-scope-review.ts`, `pricing-scope-sources-server.ts`, `pricing-scope-review-server.ts`: соответственно общие типы/проверка, чтение источников, локальный разбор. Существующие проверка чтения, якоря цитат и применимость справочников используются повторно.
- `src/utils/support-source-enrichment.ts`, `support-source-enrichment-server.ts`: рекомендации используют общий результат; лексический поиск остаётся предварительным отбором.
- В `src/app/api/pricing/evaluate-ai/`: `ai-estimator-service.ts`, `evaluation-pricelists.ts`, `evaluation-context.ts`, `evaluation-prompts.ts`, `evaluation-normalizers.ts`; в `src/utils/contract-document-hierarchy.ts` — согласованный текст общей основы.
- Новый `src/utils/pricing-scope-approval.ts`; `src/app/api/pricing/save-ledger/save-ledger-service.ts`, `ledger-input.ts`, `ledger-evidence.ts`: проверка нового автоматического расчёта перед сохранением.
- Новый `src/components/pricing/ai-estimator/pricingScopeForm.ts`; существующие `types.ts`, `hooks/useAiEstimatorState.ts`, `components/EstimatorPricingForm.tsx`, `EstimatorPricingBreakdown.tsx`, `EstimatorFinancialSummary.tsx`, `EstimatorEvidenceTrace.tsx`, `EstimatorReasoningPanel.tsx` и `src/components/pricing/AIEstimatorModal.tsx`: пустые неизвестные значения и понятное основание, без редизайна.
- Проверки: новые `scripts/verify-pricing-scope.mjs`, `verify-pricing-scope-sources.mjs`, `verify-local-pricing-scope-model.mjs`, `verify-pricing-scope-integration.mjs`, `verify-pricing-scope-ui.mjs`; общий синтетический вход `scripts/fixtures/pricing-scope-fixtures.mjs`. Также существующие профильные проверки, указанные ниже.

## Task 1: Общий допуск позиции и проверка чисел

**Интерфейсы:** в `pricing-scope-review.ts` экспортировать перечисленные типы и `validatePricingScope(context: PricingScopeContext, draft: unknown): PricingScopeResult`. `DocumentSourceInput`, `SupportCandidate`, `StatementRole` и `EvidenceAnchor` брать из существующих модулей. Модельный черновик остаётся `unknown` до проверки.

```ts
type PricingScopeStatus = 'FULL' | 'PARTIAL' | 'REJECTED' | 'NEEDS_REVIEW';
type PricingScopeSource = DocumentSourceInput & { id: string; title: string; role: 'WORK' | 'CONTRACT' | 'PRICE' | 'REFERENCE'; allowed: boolean };
type PricingScopeCandidate = SupportCandidate & { sourceId: string; noteSourceIds: string[]; priceBasis: 'EXCL_VAT' | 'INCL_VAT' | 'UNKNOWN' };
type PricingScopeContext = { workSourceIds: string[]; sources: PricingScopeSource[]; candidates: PricingScopeCandidate[] };
type PricingScopeNumber = { value: number | null; basis: 'SOURCE' | 'MANUAL' | 'UNKNOWN'; evidence: EvidenceAnchor[] };
type PricingScopeRequirement = { id: string; description: string; role: StatementRole; evidence: EvidenceAnchor[] };
type PricingScopePosition = { candidateId: string; status: PricingScopeStatus; requirementIds: string[]; reason: string; evidence: EvidenceAnchor[] };
type PricingScopeLine = { candidateId: string; requirementIds: string[]; quantity: PricingScopeNumber; unitPriceExclVat: PricingScopeNumber; coefficients: PricingScopeNumber[]; amountExclVat: number | null };
type PricingScopeResult = { version: 'price-scope-v1'; status: PricingScopeStatus; requirements: PricingScopeRequirement[]; positions: PricingScopePosition[]; lines: PricingScopeLine[]; uncoveredRequirementIds: string[]; issues: string[]; totalExclVat: number | null; requiresReview: boolean };
```

- [ ] Написать тесты на синтетических источниках. Черновик содержит требования с цитатами, для каждой позиции — оценку работы, материала, метода, единицы и условий (`MATCH`, `MISMATCH`, `UNKNOWN`, обоснованное `NOT_APPLICABLE`), покрытые операции и числовые основания. Одна операция имеет один ID во всех позициях. Проверять положительный случай, несовместимость, выдуманную цитату/ID, неподтверждённое число, частичное покрытие и повтор операции. Основные утверждения:

```js
assert.equal(valid.totalExclVat, 150); // подтверждены 2 м³ по 75, без коэффициентов
assert.equal(missingQuantity.lines[0].quantity.value, null);
assert.equal(missingQuantity.totalExclVat, null);
assert.equal(wrongMaterial.status, 'REJECTED');
assert.equal(forgedQuote.requiresReview, true);
assert.deepEqual(supplyOnly.uncoveredRequirementIds, ['installation']);
assert.equal(supplyAndInstallation.status, 'FULL');
assert.equal(compactionTwice.requiresReview, true);
assert.equal(priceExcerptAlone.requirements.length, 0);
```

- [ ] Запустить `node --experimental-strip-types --test scripts/verify-pricing-scope.mjs`: сначала ожидается FAIL из-за отсутствующего экспорта.
- [ ] Реализовать валидатор. Цитаты проверять через `findEvidenceAnchor`, чтение — `assessDocumentSourceReadiness`; страницу вычислять по источнику. Цена берётся из выбранной строки/доказанной выдержки с установленным отношением к НДС. Модель не может назначить основание `MANUAL`: это только задача 4. `MISMATCH` отклоняет позицию, `UNKNOWN` оставляет её на проверке; не относящийся к требованию признак не блокирует результат. Покрытие — объединение подтверждённых операций; повтор платной операции блокирует автоматический итог. Сокращение текста не доказывает исключение работы. Суммы пересчитывать существующими денежными функциями до копеек; подтверждённый ноль отличать от `null`.
- [ ] Повторить ту же команду: все случаи PASS, без пропусков. Не добавлять список запрещённых кодов или слов вместо проверки смысла.

## Task 2: Источники и существующая локальная обработка

**Интерфейсы:** `loadPricingScopeContext(args: { supabase: SupabaseClient; projectId: string; findingId: string }): Promise<PricingScopeContext>` в `pricing-scope-sources-server.ts`; `reviewPricingScope(context: PricingScopeContext): Promise<PricingScopeResult>` в `pricing-scope-review-server.ts`. Второй вызывает валидатор задачи 1. Экспортировать `PricingScopeLocalError extends Error` для недоступной локальной обработки.

- [ ] В `verify-pricing-scope-sources.mjs` проверить настоящий загрузчик с подменой только DB I/O: договорный выбор книги, привязку примечания к книге/редакции/границе раздела, пригодную сохранённую ценовую выдержку, непрочитанную страницу и неизвестный пункт. Закрепить `assert.deepEqual(candidate.noteSourceIds, ['same-book-section-note'])`; для посторонних примечаний — отсутствие ID, для неизвестного пункта — отсутствие подтверждённого допуска. В `verify-local-pricing-scope-model.mjs` задать пять синтетических смысловых случаев: остановка водопровода/эрув, песок с 8% цемента/материал C, подходящий материал C, доставка с включённым уплотнением, материал без монтажа. Для первых двух `assert.equal(result.status, 'REJECTED')`, для подходящего — `FULL`, для материала без монтажа — `PARTIAL`. Поменять формулировки и коды между вариантами.
- [ ] Запустить офлайн-тест источников: ожидается FAIL из-за отсутствующего загрузчика.
- [ ] Реализовать чтение без записей: исходное требование и связанные пригодные документы, договорный механизм, смета, разрешённые цены/выдержки, относящиеся примечания и пригодные положения справочников. Сохранить полные тексты; ограничивать только контекст запроса с явным указанием неполноты. `allowed` вычисляется по чтению, назначению и действующей применимости, не по категории или имени файла. Неизвестный пункт ограничивает только ссылающуюся на него позицию. Лексический поиск даёт кандидатов и не подтверждает их.
- [ ] Реализовать структурированный локальный запрос с разделением требования, события и цены. Использовать `getComparisonAiIdentity` и `generateComparisonText`; до вызова требовать `kind === 'ollama'`. При ошибке выбрасывать `PricingScopeLocalError`, без внешнего вызова и без готового результата. Модель выдаёт оценки и точные цитаты; проверенный результат формирует код задачи 1. Не придумывать недостающие объёмы и ставки.
- [ ] Повторить офлайн-тест: PASS. Запустить `node --experimental-strip-types scripts/verify-local-pricing-scope-model.mjs`: все пять смысловых случаев и варианты PASS на текущей настройке Ollama. Неподтверждённый положительный случай не считать успешным лишь потому, что он заблокирован.

## Task 3: Единый результат в рекомендациях и расчёте

**Интерфейсы:** оба потребителя вызывают интерфейсы задачи 2; сохраняют `scope_review: PricingScopeResult` внутри соответственно `support_analysis` и `pricing_evaluation`. `FULL/PARTIAL/REJECTED/NEEDS_REVIEW` отображать в существующие `DIRECT/PARTIAL/ZERO_MATCH` без потери `requiresReview`. Отсутствующие количество, цена и итог передаются как `null`.

- [ ] В `verify-pricing-scope-integration.mjs` вызвать настоящие обогатитель и `AiEstimatorService` с подменой DB/model I/O. Одна и та же неподходящая позиция отклоняется обоими; положительная принимается обоими, недостающий монтаж остаётся видимым. Проверить `assert.equal(modelCallsForTechnicalExclusion, 0)`, `assert.equal(writesForTechnicalExclusion, 0)`, `assert.equal(modelCallsForUnchangedCache, 0)`, `assert.equal(externalCalls, 0)`. Проверить отсутствие цены без выбранного подтверждённого источника, даже если в выдаче есть другие цены. При внешней настройке или недоступной Ollama: 503, ноль внешних вызовов, рекомендация не получает статус готовой.
- [ ] Запустить `node --experimental-strip-types --test scripts/verify-pricing-scope-integration.mjs`: ожидаются FAIL на существующем раздельном выборе и внешнем пути.
- [ ] Подключить общий результат к рекомендациям и расчёту. Убрать внешние вызовы ключевых слов, оценки и экспертного текста; экспертное пояснение не меняет проверенные числа. Непригодные позиции не сохранять как ценовое основание. Нормализатор не создаёт цену без источника и количество «1». Сумма нескольких строк равна проверенной разбивке; общую ставку выводить только при доказанной единице и количестве основной работы, иначе оставить её на проверке. Локальная недоступность даёт 503 и явное ограничение. Сохранить ранний запрет технических карточек, принятые записи и пропуск неизменённого кэша; не повышать его общую версию ради пересчёта истории.
- [ ] Привести `CONTRACT_DOCUMENT_HIERARCHY_GUIDE` и `DOCUMENT_PRECEDENCE_SUMMARY_HE` к уже утверждённому правилу двух справочников и точечных договорных исключений. В `scripts/verify-local-radar-model.mjs` использовать настоящий общий текст вместо тестовой подмены; добавить отсутствие прямой ссылки и исключение одной главы. Новые смысловые правила проверить автоматическими тестами, включая сохранение ограничений чтения и редакции.
- [ ] Повторить интеграцию и запустить `npm run verify:support-enrichment`, `node --experimental-strip-types --test scripts/verify-support-authority-projection.mjs`, `npm run verify:document-references`, `npm run verify:radar-quality`, `npm run verify:radar-model`, `npm run verify:support-model`: все PASS. Модельные входы только синтетические; реальные сохранённые карточки и их расчёт не запускать.

## Task 4: Понятные неизвестные значения и сохранение с доказательствами

**Интерфейсы:** `ManualPricingInputs = { quantity?: number; unitPriceExclVat?: number; markupPercent?: number }`; `assessPricingScopeApproval(review: PricingScopeResult, manual: ManualPricingInputs): { allowed: boolean; reason: string | null; totalExclVat: number | null }` в `pricing-scope-approval.ts`. В форме числовые поля количества и цены имеют тип `number | null`; `pricingScopeForm.ts` экспортирует `toPricingScopeForm(data: AIPricingEvaluationResponse): AIEstimatorFormState`. В ответ добавить необязательный `scope_review`, в форму — `manualPricingInputs: ManualPricingInputs`. Сервер получает ручные значения через `manual_pricing_inputs`.

- [ ] В `verify-pricing-scope-ui.mjs` проверить настоящие функции преобразования и сервер сохранения с подменой I/O: `assert.equal(form.quantity, null)`, `assert.equal(unknown.totalExclVat, null)`, `assert.equal(manualQuantityOnly.allowed, true)` при единственном пробеле количества, `assert.equal(wrongMaterialAfterManualQuantity.allowed, false)`. Прямая отправка неподтверждённого автоматического расчёта — 409 и ноль записей; удалённое клиентом `scope_review` не обходит серверную проверку. Старый принятый расчёт остаётся редактируемым без возрождения технической карточки. Проверить серверный рендер числового представления: неизвестная сумма — «—», подтверждённые 150 без НДС дают 27 НДС и 177 всего.
- [ ] Запустить `node --experimental-strip-types --test scripts/verify-pricing-scope-ui.mjs`: ожидается FAIL на нынешней подстановке «1» и отсутствии серверного допуска.
- [ ] Реализовать преобразование, отметки ручных чисел и общий допуск сохранения. Неизвестное поле пустое, итог — «—»; основание показывает источник, код, цитату/страницу, покрытые/недостающие работы. Ручное число устраняет только свой числовой пробел; несовместимость и непокрытая работа сохраняют проверку. Ручную ставку не выдавать за цену официального источника. Кнопка и сервер используют одинаковый допуск. Сервер читает оценку из карточки, сверяет входящие значения и итог с разбивкой; клиентская отметка пригодности не является доказательством. Старые финансовые записи и самостоятельный ручной ввод сохраняют прежний путь; старые неподтверждённые подсказки не дают новых автоматических подтверждений.
- [ ] Повторить новую проверку и `node --experimental-strip-types --test scripts/verify-radar-financial-guards.mjs`: PASS. В `scripts/verify-financial-invariants.mjs` заменить только устаревшие требования к внешнему вызову/выдуманному черновику проверкой нового поведения; финансовую защиту не ослаблять.

## Task 5: Проверка выпуска и сохранности

**Результат:** проверенная production-сборка на `http://localhost:3002/`, сохранённые данные и один коммит реализации в существующей ветке. До проверки новая сборка не заменяет работающую.

- [ ] Выполнить `npx tsc --noEmit`, ESLint только изменённых файлов, новые офлайн-тесты задач 1–4, `npm run verify:financials`, `npm run verify:source-readiness`, `npm run verify:document-references`, `npm run verify:radar-saved-review`, `npm run verify:scan-retention` и `npm run verify:radar-history`. Для истории установить `RADAR_MTM_SNAPSHOT=data/point1-audit/point14-current-mtm-verification-20261025.json`. Ожидается exit 0, без пропусков и ослабления прежних условий. Результаты модельных проверок после последнего изменения подсказок должны быть свежими.
- [ ] Собрать отдельный output: `$env:CONTRACTOR_NEXT_DIST_DIR='.next-point14-price-scope'`, затем `npm run build`. Ожидается успешная production-сборка. После проверки свободного порта запустить контроль на 3003 через `Start-Process -WindowStyle Hidden` с тем же output; действующий 3002 пока сохраняется.
- [ ] Выполнить последовательный `verify:open-workspace-runtime` на контроле; после входа в IAB открыть проект, радар, документы и финансы. Новый расчёт показать на синтетической тестовой странице/подменённом ответе без реального POST: полное/частичное покрытие, неизвестное количество и недоступный локальный обработчик. Не открывать автоматическую оценку сохранённых рабочих карточек: она может записать данные. Проверка функций выполнена настоящими обработчиками в задачах 3–4; подмена IAB не заменяет эти тесты.
- [ ] Сверить свежие контрольные хеши и самостоятельно проверить все пять пунктов фокуса. Установить уже проверенную сборку на 3002 заменой только проверенного PID; каталог не переносить. При сбое вернуть прежний output `.next-point14-default-policy`. Повторить вход и основные экраны установленной версии, сверку сохранности; контроль 3003 остановить.
- [ ] Обновить этот план и `docs/HANDOFF_CURRENT_RU.md`: фактические проверки, build ID, output, адрес, сохранность и оставшиеся ограничения всей 1.4. Выполнить `git diff --check`, добавить только файлы этого выпуска, проверить staged diff, сделать понятный коммит и push. Новая проверка состава цены не объявляет весь корпус справочников прочитанным.

## Самопроверка плана

Требование и ценовая выдержка — задачи 1–2; договорная применимость и состав цены — 2–3; цитаты, количества, коэффициенты, арифметика и отсутствие повторов — 1 и 4; единый локальный путь — 2–3; понятный результат и серверный допуск — 4; модельная приёмка, работа приложения и сохранность — 3 и 5. Все пять дополнительных рисков имеют тесты. Интерфейсы последующих задач используют имена задачи 1. Нового охвата, новых зависимостей и повторной обработки реальных документов план не добавляет.

Следующий шаг — просмотр плана владельцем; после подтверждения исполнить его самостоятельно в текущем чате.
