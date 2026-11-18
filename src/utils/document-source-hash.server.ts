import 'server-only';
import {createHash} from 'node:crypto';

/** Verify the downloaded original, never the catalogue's claimed content_hash. */
export function verifyDocumentSourceHash(bytes: Uint8Array, sourceHash: string | null): boolean {
    return sourceHash === null || (/^[a-f\d]{64}$/iu.test(sourceHash)
        && createHash('sha256').update(bytes).digest('hex') === sourceHash.toLowerCase());
}
