import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathKey, refusal } from './maintenance/policy.mjs';
import { backupCli } from './maintenance/backups.mjs';

export const backupHash = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function parsePageSize(value = 250) {
  if (!/^[0-9]+$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 1000) {
    throw refusal('Page size must be an integer from 1 through 1000');
  }
  return Number(value);
}
export function publicTables(schema) {
  if (!Array.isArray(schema.tables)) throw refusal('The database schema metadata is missing');
  const tables = schema.tables.filter(table => table.schema === 'public').sort((a, b) => a.name.localeCompare(b.name));
  if (!tables.length || tables.some(table => !/^[a-z_][a-z0-9_]*$/.test(table.name)) || new Set(tables.map(t => t.name)).size !== tables.length) {
    throw refusal('Invalid public table coverage');
  }
  return tables.map(table => {
    const primaryKey = table.constraints?.find(c => c.type === 'p')?.definition.match(/\(([^)]+)\)/)?.[1]
      .split(',').map(x => x.trim().replaceAll('"', ''));
    if (!primaryKey?.length || primaryKey.some(key => !/^[a-z_][a-z0-9_]*$/.test(key))) throw refusal('An ordered primary key is required');
    return { name: table.name, primaryKey };
  });
}
export function snapshotFingerprint(manifest, files) {
  const { createdAt, finishedAt, destination, ...material } = manifest;
  const manifestBytes = Buffer.from(canonical(material));
  const entries = [...files, { file: 'manifest.json', size: manifestBytes.length, sha256: backupHash(manifestBytes) }]
    .sort((a, b) => a.file.localeCompare(b.file));
  return backupHash(canonical(entries));
}

async function storageListing(client) {
  const result = await client.storage.listBuckets();
  if (result.error || !Array.isArray(result.data)) throw refusal('Storage bucket listing failed');
  const buckets = result.data.sort((a, b) => a.id.localeCompare(b.id));
  if (buckets.some(b => typeof b.id !== 'string' || !b.id) || new Set(buckets.map(b => b.id)).size !== buckets.length) throw refusal('Invalid Storage buckets');
  const objects = [];
  for (const bucket of buckets) {
    const folders = [''], visited = new Set();
    for (let cursor = 0; cursor < folders.length; cursor++) {
      const prefix = folders[cursor];
      if (visited.has(prefix)) throw refusal('Storage folder listing repeated');
      visited.add(prefix);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.storage.from(bucket.id).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error || !Array.isArray(data) || data.length > 1000) throw refusal('Storage object listing failed');
        for (const item of data) {
          if (typeof item.name !== 'string' || !item.name || /[\x00-\x1f]/.test(item.name)) throw refusal('Invalid Storage key');
          const key = prefix ? prefix + '/' + item.name : item.name;
          if (item.id) objects.push({ bucket: bucket.id, key, metadata: item }); else folders.push(key);
        }
        if (data.length < 1000) break;
      }
    }
  }
  objects.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.key.localeCompare(b.key));
  if (new Set(objects.map(o => canonical([o.bucket, o.key]))).size !== objects.length) throw refusal('Storage listing contains duplicate objects');
  return { buckets, objects };
}

// Hash-only by default. Materialization supplies a sequential sink. Every pass
// downloads fresh bytes and independently rereads all table pages.
export async function captureBackupSnapshot({ client, schemaBytes, pageSize, sink, now = new Date().toISOString() }) {
  pageSize = parsePageSize(pageSize);
  schemaBytes = Buffer.from(schemaBytes);
  const tables = publicTables(JSON.parse(schemaBytes.toString('utf8'))), files = [];
  const manifest = { version: 2, createdAt: now, schemaSha256: backupHash(schemaBytes), tables: [], buckets: [], objects: [], errors: [] };
  async function record(file, produce, materialize = true) {
    const hash = createHash('sha256'); let size = 0;
    const output = materialize ? await sink?.(file) : null;
    let failure;
    try {
      await produce(async chunk => { chunk = Buffer.from(chunk); size += chunk.length;
        if (!Number.isSafeInteger(size)) throw refusal('Backup input size is out of range');
        hash.update(chunk); await output?.write(chunk); });
    } catch (error) { failure = error; throw error; }
    finally {
      try { if (failure && output?.abort) await output.abort(); else await output?.close(); }
      catch (cleanup) {
        if (!failure) throw cleanup;
        (failure.cleanupFailures ??= []).push({ operation: 'stream-close', code: cleanup.code ?? 'FAILED' });
      }
    }
    const entry = { file, size, sha256: hash.digest('hex') };
    if (materialize) files.push(entry);
    return entry;
  }
  async function rows(table, push) {
    let expected = null, seen = 0;
    await push('[');
    for (let start = 0; ; start += pageSize) {
      let query = client.from(table.name).select('*', { count: 'exact' });
      for (const column of table.primaryKey) query = query.order(column);
      const { data, error, count } = await query.range(start, start + pageSize - 1);
      if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 ||
          expected !== null && expected !== count || data.length !== Math.min(pageSize, Math.max(0, count - start))) {
        throw refusal('Inconsistent backup table page: ' + table.name);
      }
      expected = count;
      for (const row of data) await push((seen++ ? ',' : '') + canonical(row));
      if (seen === count) break;
    }
    await push(']');
    return seen;
  }
  await record('schema.json', push => push(schemaBytes));
  for (const table of tables) {
    let count;
    const entry = await record('tables/' + table.name + '.json', async push => { count = await rows(table, push); });
    manifest.tables.push({ ...table, ...entry, count });
  }
  const listing = await storageListing(client);
  manifest.buckets = listing.buckets;
  for (const object of listing.objects) {
    const expected = object.metadata.metadata?.size;
    if (!Number.isSafeInteger(expected) || expected < 0) throw refusal('Storage object size is unavailable');
    const response = await client.storage.from(object.bucket).download(object.key);
    if (response.error || !response.data) throw refusal('Storage download failed');
    const entry = await record('objects/' + backupHash(object.bucket + '\0' + object.key), async push => {
      if (typeof response.data.stream === 'function') {
        let size = 0;
        for await (const chunk of response.data.stream()) {
          size += chunk.length;
          if (size > expected) throw refusal('Storage bytes exceed the listed object size');
          await push(chunk);
        }
      } else {
        if (!Number.isSafeInteger(response.data.size) || response.data.size !== expected ||
            expected > 16 * 1024 ** 2) throw refusal('Storage object requires bounded streaming');
        await push(Buffer.from(await response.data.arrayBuffer()));
      }
    });
    if (entry.size !== expected) throw refusal('Storage bytes differ from the listed object size');
    manifest.objects.push({ ...object, ...entry });
  }
  if (canonical(await storageListing(client)) !== canonical(listing)) throw refusal('Storage listing changed during the backup');
  for (const table of manifest.tables) {
    const again = await record(table.file, push => rows(table, push), false);
    if (again.sha256 !== table.sha256 || again.size !== table.size) throw refusal('Table rows changed during the backup: ' + table.name);
  }
  manifest.finishedAt = now;
  return { manifest, files, bytes: files.reduce((sum, file) => sum + file.size, 0), contentFingerprint: snapshotFingerprint(manifest, files) };
}

export async function backupMain(args = process.argv.slice(2)) {
  return backupCli(args);
}
const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl && (process.platform === 'win32' ? entryUrl.toLowerCase() === import.meta.url.toLowerCase() : entryUrl === import.meta.url)) {
  try { console.log(JSON.stringify(await backupMain(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ code: error.code ?? 'FAILED', message: error.message })); process.exitCode = 1; }
}
