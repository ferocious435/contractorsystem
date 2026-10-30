# Рабочий Codex внутри ContractorSystem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Выполняет текущий помощник в этом чате по задачам; дополнительные AI-исполнители и независимый AI-проверяющий не разрешены. Шаги отмечаются только по фактическим результатам.

**Goal:** владелец запускает AI-действие кнопкой, получает и сохраняет результат в программе; рабочий Codex отделён от разработки.

**Architecture:** сервер проверяет пользователя и данные, сохраняет задание и исполняет его через один ограниченный процесс Codex app-server. Модель возвращает результат; программа проверяет источники, версии и деньги, сохраняет результат и показывает его в текущем разделе. Очередь и HTTP-контракт общие; предметные обработчики сохраняют действующие правила.

**Tech Stack:** текущие Next.js15/React19/TypeScript, Node24, Supabase/PostgreSQL, установленный Codex CLI с stdio; новые зависимости автоматически не устанавливаются.

**Spec:** [одобренный проект](../specs/2026-10-30-codex-program-runtime-design.md), SHA256 `0a2b76e991b2a8d0b67fdc5d1e48eaa7df02c7f0e9ce1e9a7137e02dbb253edc`. Одобрение: user`01a18bd6-7c67-78d2-8100-3f1441497b15`; источник `.superpowers/codex-program-runtime-2026-10-30/design-approval-evidence.json`. Gate `planning` разрешён. **Сам этот план ещё не одобрен и не выполняется.**

## Global Constraints

- «Рабочие запросы и история разработки разделены»; «Для начальной версии одновременно исполняется одно прикладное модельное задание».
- «Конкретная модель и режим в этом проекте не предписаны»; ручной выбор рабочего профиля принадлежит владельцу, текущий чат не меняется.
- «Токены не копируются в код, базу приложения, браузер или журнал»; секрет базы не передаётся процессу модели.
- «Прикладное задание «написать письмо» не запускает процесс разработки и согласование изменения системы».
- «Неизменённый корпус автоматически не перечитывается и не анализируется повторно»; приостановленные материалы не запускать.
- «Суммы и НДС формирует существующая арифметика программы»; стиль и степень официальности задаёт пользователь.
- «Результат письма появляется как редактируемое предложение»; DRAFT и отдельная ручная отметка отправки сохраняются.
- «Новые зависимости не устанавливаются автоматически»; будущие API/серверы не являются условиями первой версии.
- Все пять областей из раздела3 проекта входят в результат. Старый локальный R04 не объявляется принятым; принятые1.3/1.4/MTM/D1/D2 и остаток1.2/D3/1.5 сохраняют свой фактический статус.
- Защищённая папка владельца — только чтение. Не создавать настоящие пробные письма, не пересевать рабочую базу, не применять повторно миграцию писем.

## Review Focus

1. Смена исполнителя меняет старые подписи кэша: при тех же документах/связях/правилах нужна проверяемая повторная выдача сохранённого результата без модели — задачи6–8.
2. Codex ошибочно отклоняется старым `Local AI`-фильтром либо отдельная ветвь продолжает требовать прежнюю модель — задачи4 и10.
3. Обновление страницы, повтор кнопки, поздний ответ после отмены или правки редактора: один результат и сохранность текста — задачи2,3,5.
4. PDF с непрочитанной страницей, короткий законченный документ, DOCX с изображением и неподдержанная выбранной моделью модальность: без ложного полного чтения — задача9.
5. Частичный RPC-поток, изменённый источник, чужой проект/профиль и инструкция внутри документа: без ложного успеха, чужого доступа и изменения кода — задачи1–3,5,7–10.

## Карта файлов и ответственность

| Узел | Создать | Смысл изменения существующих файлов |
|---|---|---|
| Контракты и подключение | `src/server/ai/contracts.ts`, `owner.server.ts`, `profile.server.ts`, `codex-client.server.ts` | Изолированный клиент без изменения глобальной конфигурации |
| Состояния и исполнитель | `src/server/ai/jobs.server.ts`, `worker.server.ts`, `service.server.ts`, `handlers/index.ts` | Новая служебная таблица и ограниченные серверные операции |
| HTTP и браузер | `src/app/api/ai/jobs/route.ts`, `src/app/api/ai/jobs/[jobId]/route.ts`, `src/app/api/ai/jobs/[jobId]/cancel/route.ts`, `src/app/api/ai/runtime/route.ts`; `src/utils/ai-job-client.ts`, `src/hooks/useAiJob.ts`, `src/components/features/ai/AiRuntimeSettings.tsx` | Настройки, состояние и наблюдение в текущих экранах |
| Письмо/консультант | `src/server/ai/handlers/letter.ts`, `consultant.ts`, `src/utils/business-writing-result.ts` | Перевести два маршрута и их клиенты, сохранив сохранение и снимки |
| Сравнения/кэш | `src/server/ai/comparison.server.ts`, `src/utils/ai-analysis-reuse.ts` | Явный контекст исполнения и сохранность пригодного старого анализа |
| Радар | `src/server/ai/handlers/radar.ts`, `src/server/ai/radar-service.server.ts` | Выделить существующую работу сканирования из HTTP-маршрута без смены предметных правил |
| Расценки/источники | `src/server/ai/handlers/pricing.ts`, `support.ts` | Перевести действующие серверные разборы и API-клиенты |
| Документ | `src/server/ai/handlers/document.ts`, `src/utils/document-analysis-prompt.ts`, `src/utils/document-ai-input.ts` | Убрать прямой прежний модельный вызов; сохранить извлечение и покрытие |
| Проверки | `scripts/codex-runtime/{load-server,fixtures,db,stage,native,release}.mjs`; профильные `scripts/verify-codex-*.mjs` по задачам ниже | Использовать существующий TypeScript/UI-загрузчик и изолированный тестовый PostgreSQL |

`M` далее — **единственный фактический путь**, который вернёт установленный CLI при `migration new codex_runtime_jobs` в задаче2. Это определённый результат команды, а не придуманный timestamp. Записать его в `.superpowers/codex-program-runtime-2026-10-30/migration-path.json` и далее использовать этот путь.

## Общие интерфейсы и правила вызова

Типы определяет задача1 в `contracts.ts`; каждый следующий модуль импортирует их, не создавая другую трактовку полей.

```ts
type AiJobKind = 'letter'|'consultant'|'scan'|'scan_preview'|'pricing'|'work_change'|'support_enrichment'|'document_analysis';
type AiJobState = 'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'INTERRUPTED';
type JsonValue = null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
type JsonObject = {[key:string]:JsonValue};
type RuntimeProfile = {ownerId:string; accountFingerprint:string; model:string; effort:string|null; revision:number};
type JobDto = {id:string; projectId:string; kind:AiJobKind; state:AiJobState; revision:number;
  conversationId:string|null; clientContextId:string|null; result:JsonValue|null; error:{code:string;message:string}|null};
type AiTurnInput = {text:string; images?:readonly string[]; outputSchema:Record<string,unknown>};
type PreparedAiResult = {result:JsonValue; effects:readonly VerifiedAiEffect[]};
type VerifiedAiEffect = {type:'SCAN_FINDING'|'SCAN_STATE'|'PRICING_EVIDENCE'|'DOCUMENT_ANALYSIS'; targetId:string; expectedRevision:string; data:JsonObject};
interface AiExecutionContext {
  jobId:string; ownerId:string; projectId:string; profile:RuntimeProfile; signal:AbortSignal;
  generate(input:AiTurnInput):Promise<string>; checkActive():Promise<void>;
}
interface AiJobHandler {
  validate(payload:unknown):JsonObject;
  execute(payload:JsonObject, execution:AiExecutionContext):Promise<PreparedAiResult>;
}
```

Полный внутренний `AiJobRecord` дополнительно содержит request key/input hash, неизменяемый снимок профиля и контекста, attempt, lease token/expiry, прогресс и timestamps. Эти сведения не принимаются от браузера как доверенные. `VerifiedAiEffect` создаёт только серверная предметная проверка; SQL обрабатывает фиксированный список операций/полей без динамического SQL и без изменения финансовых сумм. Модель не получает функции записи.

`clientContextId` — только проверяемый UUID корреляции формы: для письма существующий clientDraftId, для консультанта ID разговора. Он не даёт полномочий и всегда проверяется вместе с owner/project. Восстановленный результат другого черновика не подставляется в открытый редактор.

**Граница очереди:** только пользовательское действие создаёт задание. Внутренние сравнения одного задания вызывают `execution.generate()` последовательно, не ставят дочернее задание в ту же очередь и не запускают дополнительных агентов. Запись бизнес-результата и успешное завершение проверяют актуальный lease/версию атомарно. Частичные результаты явно отличаются от полного успеха.

## Общая проверка G перед сохранением каждой задачи

`scripts/codex-runtime/stage.mjs --task N` создаётся в задаче1. Он выполняет указанный в задаче профиль, `npx --no-install tsc --noEmit`, `npm run verify:financials`, `npm run lint`, production-сборку и `scripts/verify-open-workspace-runtime.mjs` на контрольном приложении после входа. Только нулевые exit codes означают прохождение; Next.js сейчас игнорирует ошибки типов при build, поэтому отдельный TypeScript обязателен.

Контроль строится из дерева **публикуемых** файлов в `.superpowers/codex-program-runtime-2026-10-30/control-source`, с отдельным dist `.next-codex-runtime-control`, слушает `127.0.0.1:3003`; занятый чужой порт не освобождать силой. Перед G подготовить только собственные кандидаты в публикуемое дерево и проверить отсутствие чужих staged-правок. Это копия для сборки без `.git`; использовать существующие зависимости, не новый worktree. Проверенный A на3002 и его исходную контрольную папку сохранять до финальной установки. Дополнительный AI-клиент и новый чат не создавать.

До облачного применения M новые операции проверяются на изолированном синтетическом API/SQL-стенде с реальными модулями программы; существующий A отдельно проверяется после настоящего входа. Это подтверждает сохранность рабочего выпуска и новую контролируемую логику, но не объявляется установленной облачной интеграцией. В задаче10 после M отдельно проверяется настоящий новый runtime. Тестовых переключателей авторизации/подмены данных в продукт не добавлять.

В начале выполнения сохранить Git/status и исходные байты чужих изменений, кэша и14 проверяемых разделов базы. Для пересечения с грязным `DocumentsPageClient.tsx` менять только вызов AI/наблюдение результата, сохранив предыдущие исправления чтения. Собственные изменения в пересекающихся файлах фиксировать отдельными фрагментами; не публиковать соседние правки владельца и не сбрасывать рабочий файл. Сохранность подтверждать исходным снимком и собственным обратимым патчем в памяти. Старый проверочный baseline не переписывать задним числом.

После G — самопроверка фактического diff и коммит только перечисленных собственных файлов/фрагментов; не `git add .`. Для коммита/отправки использовать разовые `-c maintenance.auto=false -c gc.auto=0`, не менять настройки Git глобально. Сверить удалённый commit, записать результат/остаток и следующий шаг. Модельные прогоны в G по умолчанию не входят; успех уже проверенного неизменённого примера повторно модели не отправлять.

## Задача1. Контракты, рабочий профиль и ограниченное подключение

**Files:** создать `contracts.ts`, `owner.server.ts`, `profile.server.ts`, `codex-client.server.ts` из карты; `scripts/codex-runtime/load-server.mjs`, `fixtures.mjs`, `stage.mjs`; `scripts/verify-codex-protocol.mjs`.

**Interfaces:** `resolveRuntimeOwner(admin:SupabaseClient):Promise<string>` читает ровно одного `profiles.role='super_admin'`, как действующий `open-workspace.ts`, без его изменения. `readRuntimeProfile(ownerId):Promise<RuntimeProfile|null>`, `saveRuntimeProfile(ownerId, selection, expectedRevision):Promise<RuntimeProfile>`. `createCodexClient({spawnProcess,clock,runtimeDir}):CodexClient`; клиент предоставляет `request(method,params)`, `runTurn(input,profile,signal):Promise<string>`, `interrupt(threadId,turnId)`, `close()`.

Здесь `selection:{model:string;effort:string|null}`; account fingerprint получает сервер из подтверждённого входа. `CodexClient.request<T>(method:string,params:unknown):Promise<T>`, `interrupt(threadId:string,turnId:string):Promise<void>`, `close():Promise<void>`; `runTurn(input:AiTurnInput,profile:RuntimeProfile,signal:AbortSignal):Promise<string>`. Внедряемые `spawnProcess` и clock имеют стандартные интерфейсы Node child_process/таймеров; тестовая фикстура управляет потоками и временем без Codex.

- [ ] **RED:** в `verify-codex-protocol.mjs` добавить сценарии раздробленного JSON-RPC/чужого request ID/exit/тайм-аута, отсутствия ручного профиля и отказа запрещённого tool request. С фикстурой управляемого процесса проверить `assert.equal(fx.turnStartCalls,0)` до явного профиля; после неполного потока `await assert.rejects(fx.run(),{code:'AI_RESPONSE_INCOMPLETE'})`; недопустимая команда не выполняется.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-protocol.mjs`; получить FAIL из-за отсутствующего контракта/клиента, а не из-за внешней сети.
- [ ] Реализовать интерфейсы. Служебная папка — `%LOCALAPPDATA%/ContractorSystem/ai-runtime`, вне репозитория; профиль сохраняется атомарно и не содержит токенов. stdio, `windowsHide:true`, собственные прикладные инструкции, `ephemeral:true`, `sandbox:'read-only'` при создании и `sandboxPolicy:{type:'readOnly',networkAccess:false}` для хода; никакого общего raw-RPC прокси. Проверить значения по экспортированным схемам0.162.1. Отключить поддержанные `shell_tool`, `unified_exec`, `code_mode_host`, `multi_agent`, `multi_agent_v2`, apps/plugins/memories и запросы расширения полномочий; не загружать проектные инструменты/хуки. Неизвестный или неотключённый инструмент не считать безопасным. В окружение дочернего процесса передавать только необходимые системные пути и существующий путь Codex без изменения его значения; ключи базы/`.env` исключить. Модель — только из сохранённого ручного выбора, `allowProviderModelFallback:false`. Метаданные/список моделей не запускают inference. Пределы реализации: startup30s, один turn300s, строка RPC16MiB; везде ограничение и явная ошибка вместо зависания.

  До создания рабочего thread прочитать эффективные метаданные конфигурации без вывода секретов; для каждого унаследованного MCP-сервера передать только этому thread `enabled=false`, также исключить проектные инструкции/хуки. Проверить, что глобальные standalone MCP тоже не запущены: отключение одних plugins этого не доказывает. Ключи/семантику override подтвердить локальными схемами и тестом конфигурации; не менять пользовательские файлы конфигурации и не переопределять `CODEX_HOME` ради изоляции. В RED добавить конфигурацию с посторонним `required` MCP и убедиться, что он не стартовал.

  Флаги `hooks` и `request_permissions_tool` также подтверждены установленным `codex features list`; отключить их разовыми параметрами дочернего процесса до initialization/thread start. Личный config и доверенные hooks владельца на диске не менять.
- [ ] **GREEN:** повторить профиль; проверить отбрасывание raw reasoning/секретов из журналов и отсутствие изменения глобального config/AGENTS. `load-server.mjs` использует существующий `scripts/redesign/load-ui.mjs`, подменяет только серверные маркеры/зависимости в тесте; не подменяет проверяемую логику. Выполнить G.
- [ ] Сохранить собственные файлы коммитом `feat: add isolated Codex runtime client` и записать доказательства. Реального модельного запроса в этой задаче нет.

## Задача2. Хранимые задания и атомарная запись

**Files:** создать миграцию `M`, `src/server/ai/jobs.server.ts`, `scripts/codex-runtime/db.mjs`, `scripts/fixtures/codex-runtime-db.sql`, `scripts/verify-codex-jobs-db.mjs`.

**Interfaces:** `AiJobStore.enqueue(ownerId,projectId,kind,payload,requestKey,profile,{conversationId,clientContextId}):Promise<JobDto>`; `claim(workerId,now):Promise<AiJobRecord|null>`; `heartbeat(jobId,leaseToken):Promise<void>`; `complete(jobId,leaseToken,prepared):Promise<boolean>`; `fail/cancel/interruptStale`; `read/listOwned`. Все последующие записи используют только этот store.

Остальные методы: `fail(id:string,leaseToken:string,error:{code:string;message:string}):Promise<boolean>`; `cancel(ownerId:string,id:string,expectedRevision:number):Promise<JobDto>`; `interruptStale(now:number):Promise<number>`; `readOwned(ownerId:string,projectId:string,id:string):Promise<JobDto|null>`; `listOwned(ownerId:string,projectId:string,kind:AiJobKind,clientContextId?:string):Promise<JobDto[]>`. Просроченный lease даёт отказ записи; конфликт исходника возвращается типизированной ошибкой и сохраняет прежний бизнес-результат.

- [ ] **RED:** проверить RLS другого пользователя, запрет браузерных INSERT/UPDATE/DELETE, уникальность `(owner_id,project_id,request_key)`, конфликт того же ключа с другим hash и гонку двух claim: `assert.equal(claimed.filter(Boolean).length,1)`. После отмены `assert.equal(await store.complete(id,oldLease,result),false)` и проверить неизменность целевых бизнес-строк.
- [ ] Запустить новый синтетический DB-профиль и получить содержательный FAIL отсутствующей таблицы/операции. `db.mjs` предварительно проверяет task/synthetic labels, `network=none`, отсутствие портов/bind mounts; использует уже установленный `postgres:17.6`, не скачивает его автоматически и не принимает рабочий Supabase URL.
- [ ] Создать `M` командой установленного бинарника `C:/Users/97254/AppData/Local/npm-cache/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-windows-x64/bin/supabase.exe migration new codex_runtime_jobs`. Записать возвращённый путь. Добавить `project_ai_jobs`, состояния из контракта, результат/прогресс/версии/снимки/разговор, уникальный ключ и единственный глобальный lease исполнителя. Пользователю — только SELECT собственных заданий разрешённого проекта; запись только серверу. Приватные операции claim/complete/cancel и фиксированные применения `VerifiedAiEffect` — только для серверной роли, без публичного `SECURITY DEFINER` и без произвольных имён таблиц/SQL. `complete` одной транзакцией проверяет lease/state/версии, применяет проверенные изменения и сохраняет успех. Lease30s, heartbeat10s; устаревшее незавершённое задание становится `INTERRUPTED`, не запускается автоматически.
- [ ] **GREEN:** `node scripts/codex-runtime/db.mjs prepare`, затем `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-jobs-db.mjs`; проверить все роли и гонки, затем G. Проверки повторяемы без повторного пересоздания чужого контейнера. Облачную миграцию сейчас не применять.
- [ ] Коммит `feat: persist and guard business AI jobs`; сохранить путь/хэш M и результаты. Оставить настоящий архив и миграцию писем без изменений.

## Задача3. Очередь, обработчики и API задания

**Files:** создать `worker.server.ts`, `service.server.ts`, `handlers/index.ts`; `src/app/api/ai/jobs/route.ts`, `src/app/api/ai/jobs/[jobId]/route.ts`, `src/app/api/ai/jobs/[jobId]/cancel/route.ts`; `scripts/verify-codex-worker.mjs`, `scripts/verify-codex-job-routes.mjs`.

**Interfaces:** `registerAiHandler(kind:AiJobKind,handler:AiJobHandler):void`, `createOwnedAiJob(request:Request,kind:AiJobKind,payload:unknown):Promise<Response>`; `runQueuedAiJobs():Promise<void>`; `getOwnedAiJob(request:Request,id:string):Promise<Response>`; `cancelOwnedAiJob(request:Request,id:string,expectedRevision:number):Promise<Response>`. `worker` создаёт `AiExecutionContext` только из доверенного задания/профиля; `execution.generate()` вызывает клиент задачи1 в уже захваченном задании. Доступные kinds в readiness соответствуют зарегистрированным обработчикам; незаконченная ветвь контрольного выпуска не выдаётся за готовую.

- [ ] **RED:** для двух запросов с одним request key проверить `assert.equal(fx.modelTurns,1)`; для двух экземпляров worker — не более одного активного turn. Чужие UUID/project/profile →403/404 без вызова модели. Raw `prompt`, `threadId`, `ownerId`, незарегистрированный kind из браузера отвергаются. Задание со вложенными двумя сравнениями завершается без повторной постановки в очередь.
- [ ] Запустить оба профиля через `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-worker.mjs scripts/verify-codex-job-routes.mjs`; подтвердить RED.
- [ ] Реализовать `POST ->202 {success:true,job:JobDto}`, чтение/список и отмену. Подтверждать текущего пользователя, единственного владельца установки и принадлежность проекта; не доверять user metadata/переданным owner IDs. Зарегистрировать только фиксированные серверные обработчики. Возврат частичного потока не завершает задание; terminal success — только `turn/completed.status==='completed'`, проверка предметного результата и успешный `complete`. `failed/interrupted/timeout` не становятся успехом. Код модели не вызывает SQL. После перезапуска прежние незавершённые задания помечаются прерванными; повтор — явное действие. Прогресс без reasoning. Не выставлять raw сведения аккаунта/профиля/lease в DTO.
- [ ] **GREEN:** повторить оба профиля, добавить имитацию разрыва между ответом Codex и транзакцией complete, затем G. Ошибка не скрывает прежний результат и не запускает второй turn.
- [ ] Коммит `feat: execute owned AI jobs through a guarded queue`.

## Задача4. Настройки рабочего помощника и общий клиент программы

**Files:** создать `src/app/api/ai/runtime/route.ts`, `AiRuntimeSettings.tsx`, `ai-job-client.ts`, `useAiJob.ts` из карты; изменить `src/components/features/SettingsView.tsx`, `src/hooks/useAiReadiness.ts`, `src/app/api/system/ai-status/route.ts`, `src/utils/ai-readiness.ts`; тест `scripts/verify-codex-ui.mjs`.

**Interfaces:** `startAiAction(url,payload,requestKey):Promise<JobDto>`; `observeAiJob(id,{signal,onProgress}):Promise<JsonValue>`; `cancelAiJob(id,revision):Promise<JobDto>`; `restoreAiJobs(projectId,kind,clientContextId?):Promise<JobDto[]>`. Abort наблюдения при уходе со страницы не отменяет задачу; отдельная кнопка отмены вызывает cancel. Настройки сохраняются через `saveRuntimeProfile` с проверкой ревизии.

`useAiJob({projectId,kind,clientContextId,onResult})` возвращает `{job,error,pendingResult,start,cancel}`; `onResult(result,job)` применим только к текущему context/ticket. `start(url,payload,requestKey):Promise<void>` и `cancel():Promise<void>` используют приведённые API; изменение редактора после start оставляет ответ в `pendingResult`, без автоматической подстановки.

- [ ] **RED:** новый статус `provider:'Codex'` принимается клиентом; старая локальная проверка больше не блокирует кнопки. Проверить, что до ручного сохранения модель не выбрана; после выбора сохраняются именно переданные значения без подмены. Чужой пользователь не получает доступ к аккаунту установки. Повторное открытие восстанавливает готовый result и `assert.equal(fx.turnStartCalls,0)`.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-ui.mjs`; подтвердить RED.
- [ ] Реализовать проверенные account/model metadata без генерации, ручной выбор и безопасный вход ChatGPT при необходимости. Состояния обычными словами в существующем оформлении; провайдер/доступность проверяются по Codex, не по `.env` прежнего движка. GET/readiness не начинает model turn. Наблюдение: интервал1s с увеличением до5s при неизменном статусе, прекращается на terminal; ответ чужого проекта/устаревшего ticket игнорируется. Никакого автоматического сохранения предвыбранной модели. Остальные настройки проекта/финансов не расширять.
- [ ] **GREEN:** профиль и G; проверить экран во встроенном браузере. Предоставить владельцу контрольный адрес и возможность один раз выбрать рабочую модель/режим в программе. До его фактического выбора live inference не запускать; независимую работу следующих задач продолжать на фикстурах.
- [ ] Коммит `feat: configure and observe the in-app Codex assistant`.

## Задача5. Письмо и консультант через сохранённое задание

**Files:** создать `handlers/letter.ts`, `handlers/consultant.ts`, `business-writing-result.ts` из карты, `scripts/verify-codex-writing.mjs`; изменить `src/app/api/generate-letter/route.ts`, `src/app/api/chat/route.ts`, `src/components/features/smart-letter/api/smartLetterApi.ts`, `src/components/features/AIConsultant.tsx`, `src/components/features/smart-letter/letterDraftSession.ts`, `src/components/features/smart-letter/hooks/useSmartLetterState.ts`, `src/components/features/smart-letter/LetterWorkspaceView.tsx`, `src/components/features/smart-letter/types.ts`; `src/utils/local-project-context-server.ts` — только выделение общих чтения/источников.

**Interfaces:** `letterHandler:AiJobHandler`, `consultantHandler:AiJobHandler`; `validateWritingResult(raw,allowedFacts,snapshot):JsonValue`. Существующие `generateLetter(payload)` и `saveVoLetter(payload)` сохраняют форму конечного результата; первая теперь ожидает/восстанавливает job, вторая остаётся прежней записью DRAFT. История консультанта восстанавливается по project/conversation из job store.

- [ ] **RED:** пользовательская дата из исходных данных разрешена; придуманная сумма/цитата отвергается. Пустой выбор ссылок моделью не теряет семь выбранных сохранённых источников. Проверить `.09 + .03 -> .12` существующим снимком, повтор DRAFT без дубликата, отдельный SENT, отмену и поздний результат после ручной правки: `assert.equal(editor.text,'ручная правка')`. Повторное открытие разговора не вызывает модель.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test --test-skip-pattern='real synthetic database' scripts/verify-codex-writing.mjs scripts/verify-local-writing.mjs`; подтвердить RED именно нового поведения без незапущенной старой DB-фикстуры.
- [ ] Реализовать обработчики с текущими preview/ownership/снимками; естественный иврит и выбранный пользователем тон без старого общего запрета цифр/дат. Цитаты и финансовый блок формирует программа. Извлечь переиспользуемые проверки без подключения старого генератора. Сохранить ticket/project/clientDraftId/editor revision; разрешить ручную правку во время генерации, отдельную отмену и просмотр готового варианта. Новый ответ не затирает более позднюю правку. Старые `local-letter-server.ts`/`local-consultant-server.ts` и экспериментальные параметры не включать в новый рабочий путь. Автоматической отправки письма нет.
- [ ] **GREEN:** профиль, финансовые/письменные проверки и G. Для прежнего полного DB-теста отдельно подготовить проверенный синтетический контейнер через `node scripts/letters-db.mjs prepare`, затем выполнить его без skip; не пересоздавать фикстуры параллельно. IAB-сценарий: кнопка → результат → правка → DRAFT → повторное открытие → печать/CSV → отдельный SENT. Не выдавать фикстурный текст за проверенный реальный ответ Codex; нативный сценарий отдельно в задаче10.
- [ ] Коммит `feat: run letters and consultant tasks inside the program`.

## Задача6. Общий адаптер сравнения и пригодный сохранённый анализ

**Files:** создать `comparison.server.ts`, `ai-analysis-reuse.ts`, `scripts/verify-codex-comparison.mjs`; прочитать/подключать `document-scan-memory.ts`, `work-change-cache-server.ts`, `pricing-scope-signature.ts` без сброса их данных. Старый `comparison-ai.ts` заменяется окончательно в задаче10 после перевода потребителей.

**Interfaces:** `generateComparisonText(prompt:string,execution:AiExecutionContext,options:{responseFormat?:Record<string,unknown>}):Promise<string>`; `getComparisonAiIdentity(execution):{kind:'codex';provider:'Codex';model:string}`; `reusableAnalysisKeys(inputs:JsonObject,currentIdentity:JsonObject,observedHistoricalIdentities:readonly JsonObject[]):string[]`. Адаптер не создаёт новый job и не читает модель из глобального config.

- [ ] **RED:** две генерации одного родительского задания используют один контекст/очередь; отсутствие доверенного execution отвергается. Прежняя принятая запись с теми же полными входами возвращается без модели: `assert.equal(fx.modelCalls,0)`. Изменение связанного документа/позднего согласования/правил не считается тем же входом; неподтверждённое покрытие PDF не даёт reuse.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-comparison.mjs`; подтвердить RED.
- [ ] Реализовать адаптер и ключи. До замены пути зафиксировать наблюдавшиеся прежние identity/signature как метаданные, без вызова модели и без закрепления конкретной модели как требования. Для старых непрозрачных hash вычислять исторический ключ из **тех же** полных документов/связей/версии правил и наблюдавшегося identity; не считать совпадение имени/даты достаточным. Новый профиль сам по себе не инвалидирует пригодный старый анализ. Проверять структуру/цитаты/покрытие перед reuse. Не мигрировать/перезаписывать27 настоящих файлов кэша и не запускать массовый повтор при отсутствии доказанного reuse.
- [ ] **GREEN:** профиль и G. Новые модули самостоятельны; ещё не переведённые ветви приватного контрольного выпуска не объявлять готовыми и не запускать через другой движок. Принятый A остаётся доступен.
- [ ] Коммит `feat: add context-bound comparison and safe analysis reuse`.

## Задача7. Радар и предварительная проверка

**Files:** создать `handlers/radar.ts`, `radar-service.server.ts`, `scripts/verify-codex-radar.mjs`; изменить `/api/scan/route.ts`, `/api/scan/preview/route.ts`, `contradictionRadarApi.ts`, `src/app/local-ai-check/LocalAiCheckClient.tsx`; обновить только затронутые ожидания профильных тестов радара.

**Interfaces:** `radarHandler`, `scanPreviewHandler:AiJobHandler`; `runRadarScan(client:SupabaseClient,payload:JsonObject,execution:AiExecutionContext):Promise<PreparedAiResult>`. Внутри сохранить действующие chunk/context/fingerprint/grounding/history функции; передавать execution в каждый модельный вызов и вложенный разбор источников.

- [ ] **RED:** через публичное действие создаётся job; GET и повтор страницы модель не вызывают. Неизменённые полно прочитанные документы дают ноль model turns; позднее согласование блокирует старое противоречие, нейтральная запись не создаёт карточку, чужая/придуманная цитата отвергается. После отмены проверенный поздний ответ не меняет карточки/состояния. Неполный набор не становится полностью проверенным.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-radar.mjs`, затем существующие `npm run verify:radar-quality`, `verify:radar-history`, `verify:scan-memory`; подтвердить RED нового пути.
- [ ] Перенести только нужную работу сканирования из route в service, сохранив предметные правила и детерминированные GET/manual-action контракты. Модельные POST создают задания; клиент восстанавливает прогресс из них. Preview создаётся явным POST/кнопкой; прежний GET читает сохранённое состояние и не начинает генерацию из useEffect. Готовить проверенные изменения как effects; фиксировать их с проверкой job/версий. Существующие принятые source/history checks не ослаблять и не запускать прежнюю локальную модель.
- [ ] **GREEN:** новый и перечисленные профили, проверки сохранённых выводов/полноты, G. Синтетический случай с изменённым связанным документом не должен запускать весь корпус.
- [ ] Коммит `feat: route radar analysis through guarded Codex jobs`.

## Задача8. Расценки, изменения работ и дополнение источников

**Files:** создать `handlers/pricing.ts`, `handlers/support.ts`, `scripts/verify-codex-pricing.mjs`; изменить `pricing-scope-review-server.ts`, `work-change-review-server.ts`, `support-source-enrichment-server.ts`, `api/pricing/evaluate-ai/ai-estimator-service.ts`, `/api/pricing/evaluate-ai/route.ts`, `/api/scan/enrich/route.ts`, `src/components/pricing/ai-estimator/api/aiEstimatorApi.ts`, `src/components/pricing/workChangeReviewApi.ts`; подключить тот же execution из задачи7 для вложенного enrichment.

**Interfaces:** `pricingHandler`, `workChangeHandler`, `supportHandler:AiJobHandler`; `reviewPricingScope(context,execution)`, `reviewWorkChangeCase({...existingArgs,execution})`, `enrichProjectFindingsWithSupportSources({...existingParams,execution})`; `AiEstimatorService.evaluate({...existingInput,execution})`. Результаты предметных функций сохраняют нынешние типы, handler оборачивает их в `PreparedAiResult`.

- [ ] **RED:** отсутствие прежнего движка не блокирует выбранный Codex; сравнения источников внутри операции не создают вложенную очередь. Повтор пригодной расценки/разбора даёт zero turns; смета, замена работ и проектный сбор не смешиваются; модель не меняет цену/НДС/статус согласования. Источник изменился во время ответа → конфликт, прежний подтверждённый результат сохранён.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-pricing.mjs scripts/verify-pricing-scope-integration.mjs scripts/verify-work-change-service.mjs scripts/verify-support-source-enrichment.mjs`; подтвердить RED нового пути.
- [ ] Передать явный execution во все сравнения и identity/cache lookup, убрать guards прежнего провайдера из переведённых функций. Текущие preview/financial/source проверки выполнять до записи; никакого fallback и повторной проверки цен моделью. API-клиенты ожидают job и сохраняют прежнюю форму конечных данных; простые чтения/manual действия остаются обычными запросами. Применение prepared effects не записывает результат после отмены/смены источника.
- [ ] **GREEN:** перечисленные профили и остальные `verify-pricing-scope-*`, `verify-work-change-*`, `verify-support-*` **без файлов `*model*`**, затем G. Проверить актуальные источники/суммы на синтетике без записей в настоящую финансовую таблицу.
- [ ] Коммит `feat: use Codex jobs for pricing and source review`.

## Задача9. Разбор документа с сохранением полного чтения

**Files:** создать `handlers/document.ts`, `document-analysis-prompt.ts`, `document-ai-input.ts`, `scripts/verify-codex-documents.mjs`; изменить `/api/documents/process/route.ts` и только AI-вызов/ожидание в `DocumentsPageClient.tsx`. Общие средства извлечения и предыдущие исправления документов сохранять.

**Interfaces:** `documentHandler:AiJobHandler`; `prepareDocumentAiInput(prepared:PreparedDocumentAnalysisInput,profile,jobInputDir):Promise<AiTurnInput>`; `validateDocumentAnalysis(raw,savedReading):JsonObject`. Текстовый prompt извлечь из старого модуля в независимый файл без прежнего SDK/инициализации клиента.

- [ ] **RED:** короткий законченный текст анализируется; длинный полный исходник сохраняется полностью; пустые page counters и PDF с непрочитанной страницей не получают полный успех. DOCX с вложенным изображением сохраняет прежнее чтение; визуальный вход передаётся только поддерживающей его выбранной модели. Ответ queued202 не отмечает документ `SCANNED`. После отмены/новой версии исходника поздний ответ не применяется.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-documents.mjs` и `npm run verify:documents`; подтвердить RED нового пути без изменения старого теста владельца ради получения зелёного результата.
- [ ] Сохранить вызов `prepareDocumentAnalysisInput`, полный extracted text/readingVerification и локальный OCR. В Codex передавать текст и подготовленные изображения через поддержанный RPC, не выдумывать загрузку PDF как неподтверждённый input. Для изображений разрешены только созданные сервером файлы в проверенной папке задания; браузер не задаёт path. Неподдержанный конкретный материал помечается явно. Убрать прямой прежний SDK/ключ/повтор генерации из process; UI ждёт terminal job и затем перечитывает сохранённый документ. Собственную правку грязного UI-файла сохранить отдельным фрагментом, исходные owner-изменения не включать в коммит.
- [ ] **GREEN:** оба профиля, предыдущие проверки DOCX/покрытия страниц, G; сравнить полный сохранённый текст и статус чтения. Созданные временные файлы удалять только после проверки абсолютного пути внутри собственной папки; исходные документы не удалять/изменять.
- [ ] Коммит `feat: analyze supported documents through in-app Codex jobs`.

## Задача10. Сквозная приёмка и единый рабочий путь

**Files:** создать `scripts/verify-codex-integration.mjs`, `scripts/codex-runtime/native.mjs`; изменить `src/lib/comparison-ai.ts` в совместимый re-export нового адаптера без прежних SDK/defaults, `src/server/ai/handlers/index.ts` — окончательная регистрация всех восьми kinds; обновить затронутые provider-specific ожидания тестов без ослабления проверок смысла/источников/денег.

**Interfaces:** `native.mjs` читает только фактически сохранённый владельцем рабочий профиль и сохраняет `native-acceptance.json` с source/build/input/output hashes и проверкой каждого kind. Никакого нового выбора модели через CLI/окружение.

- [ ] **RED:** добавить тест полноты registry и всех активных call sites: ни один kind/маршрут не требует прежнего движка, не импортирует старый модельный SDK и не обходит queue/ownership. Проверить пользовательские состояния при входе/профиле/лимите/тайм-ауте; старый текст, сохранённые документы и экспорт доступны.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-integration.mjs`; подтвердить RED оставшихся подключений.
- [ ] Завершить переключение оставшихся подключений/registry и удалить активные импорты прежних провайдеров; исторические автономные проверки старого клиента не считать приёмкой нового пути.
- [ ] **GREEN:** повторить профиль, затем последовательно профили предыдущих задач и необходимые предметные проверки, полный G. Не пересевать тестовую базу параллельно.
- [ ] После подтверждённого ручного выбора профиля выполнить нативный сквозной сценарий через **программу и её реальные модули** на вымышленных данных: письмо/консультант, радар с поздним закрытием, расценка/источник, поддержанный документ с подтверждённым чтением. Сохранить точные входы/выходы/hash/результаты проверки смысла и иврита автором. Непригодный ответ не принимать; стиль не оценивать вместо пользователя. Дополнительных судей/моделей и повторов неизменённого успешного примера нет. В том же контрольном сценарии проверить actual client/tool restrictions на canary-файле и отсутствие доступа к коду/чужим проектам.
- [ ] Коммит/отправка `feat: complete and verify the in-app Codex assistant`; сохранить фактический статус native-приёмки, пределы и следующий шаг. Это ещё не установка нового выпуска.

## Задача11. Проверенная установка и доступность программы

**Files:** создать `scripts/codex-runtime/release.mjs`, `scripts/verify-codex-release.mjs`, `docs/CODEX_RUNTIME_RELEASE_RU.md`; текущие status/HANDOFF менять только собственными фрагментами.

**Interfaces:** `release.mjs prepare-db` проверяет целевой project ID/историю/хэш M и применяет новую миграцию один раз; `release.mjs install` принимает только сборку с совпавшими source hashes и принятой `native-acceptance.json`, проверяет работающий BUILD_ID/вход и возвращает A при отказе. Удаление/откат пользовательских данных не входит в возврат выпуска.

- [ ] **RED:** добавить в `verify-codex-release.mjs` фикстуры другого project ID, уже применённой M, несовпавшего source hash, непринятой native-проверки и отказа входа после переключения. Проверить `assert.equal(fx.appliedMigrations,0)` для неверной цели/повтора и `assert.equal(fx.activeBuild,fx.previousA)` после отказа.
- [ ] Запустить `node --import ./scripts/codex-runtime/load-server.mjs --test scripts/verify-codex-release.mjs`; подтвердить RED безопасной установки.
- [ ] Реализовать два интерфейса release с сохранёнными текущим адресом/BUILD_ID/dist/process identity. Использовать существующий доступ к Supabase; повторная миграция писем и удаление нового/старого бизнес-результата запрещены. Чужие процессы не останавливать. Реальный сервер новой начальной версии слушает только `127.0.0.1:3002`, служебный Codex доступен только по stdio.
- [ ] **GREEN:** повторить release-профиль и G; проверить staged/published sources и сохранность исходных данных. Нативные успешные неизменённые примеры задачи10 повторно не запускать.
- [ ] Выполнить `release.mjs prepare-db`: после проверки синтетической SQL-приёмки применить M один раз в правильном проекте, получить advisors/права и сверить прежние14 разделов базы. Не переходить к установке при новой ошибке миграции/прав; проверенный A продолжает работать.
- [ ] Выполнить `release.mjs install`: проверить новый фактический BUILD_ID, авторизованный runtime, основные экраны, сохранённые реальные данные/экспорт и восстановление после отказа помощника. При неуспехе автоматическая процедура возвращает проверенный A и сохраняет данные; продолжить исправление в пределах плана.
- [ ] Сохранить отчёт, commit/remote SHA, BUILD_ID, пределы и остаток, коммит `docs: record verified Codex runtime release`. Назвать завершёнными только выполненные условия CH2; старый локальный R04 не переписывать как PASS.
- [ ] Остановить только созданные тестовые процессы/контейнеры, сохранив рабочий новый выпуск, путь возврата и общие сервисы владельца.

## Самопроверка плана и передача

Связь с разделами проекта:1–2 → заголовок/задачи1–4;3 →5,7–10;4–5 →1–3,10;6 →1,4;7 →2–5;8 →5–9;9 →3–5,10–11;10 →G/10–11;11–12 → ограничения, подтверждённый инструментарий и сохранение согласований. Пять Review Focus закреплены в RED/GREEN соответствующих задач. Общие типы/сигнатуры заданы один раз; `M` определяется командой, конкретной модели/режима в требованиях нет.

Это авторская проверка текущего помощника. Метод выполнения уже задан владельцем: текущий чат, `superpowers:executing-plans`, без дополнительных AI-исполнителей. Следующий шаг — предъявить эту редакцию, получить подтверждение проверки плана и проверить gate `implementation`. До этого продуктовый код, схема базы, служебный app-server и нативные AI-прогоны по плану не запускаются.
