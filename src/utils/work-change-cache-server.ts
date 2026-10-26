import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type WorkChangeCacheStore = {
    load(projectId: string, findingId: string): Promise<unknown>;
    save(projectId: string, findingId: string, value: unknown): Promise<void>;
};
const cachePath = (projectId: string, findingId: string) => path.join(process.cwd(), 'data', 'work-change-cache',
    `${createHash('sha256').update(`${projectId}\0${findingId}`).digest('hex')}.json`);

/** Product cache stays local and never overwrites a user's finding or financial row. */
export const localWorkChangeCache: WorkChangeCacheStore = {
    async load(projectId, findingId) {
        try { return JSON.parse(await readFile(cachePath(projectId, findingId), 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
    },
    async save(projectId, findingId, value) {
        const file = cachePath(projectId, findingId);
        await mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, file);
    },
};
