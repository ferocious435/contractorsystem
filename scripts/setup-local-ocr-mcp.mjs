import { mkdir, access, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('This setup packages the verified Windows OCR MCP binary only.');
const root = path.resolve('data/tools/kreuzberg/4.10.4');
const executable = path.join(root, 'bin/kreuzberg.exe');
const expectedHash = '8dda22555ef7518a0ed6610f111f40b8c8c4adab8ad3ceacf698e86c892e08e6';
const source = 'https://github.com/kreuzberg-dev/kreuzberg-lts/releases/download/v4.10.4/kreuzberg-cli-x86_64-pc-windows-msvc.zip';
const run = promisify(execFile);
try { await access(executable); console.log('OCR MCP runtime already present.'); process.exit(0); } catch {}
await mkdir(root, { recursive: true });
const bytes = process.argv[2] ? await readFile(process.argv[2]) : Buffer.from(await (await fetch(source)).arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('OCR MCP release checksum mismatch');
const archive = path.join(root, 'package.zip');
await writeFile(archive, bytes);
const quote = value => `'${value.replaceAll("'", "''")}'`;
await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(path.join(root, 'bin'))}`], { windowsHide: true });
await writeFile(path.join(root, 'installation.json'), JSON.stringify({ version: '4.10.4', source, sha256: expectedHash }, null, 2));
const version = await run(executable, ['--version'], { windowsHide: true });
console.log(version.stdout.trim());
