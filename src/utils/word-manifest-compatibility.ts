import {createHash} from 'node:crypto';
import type {SourceManifest} from './visual-source-reading';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Recognize only the released pre-location-metadata Word serialization.
 * This permits retained evidence to be checked against current units, never a
 * cached success. Source bytes, context, assembly and every other field remain
 * in both digests. New/changed image locations still change unit input hashes.
 */
export function matchesLegacyWordManifestHash(manifest: SourceManifest, previousHash: unknown): boolean {
    if (manifest.format !== 'DOCX' || typeof previousHash !== 'string' || !/^[a-f0-9]{64}$/.test(previousHash)) return false;
    const verification = manifest.nativeVerification;
    if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return false;
    const native = verification as Record<string, unknown>;
    if (native.version !== 'docx-image-coverage-v1' || !Array.isArray(native.images)) return false;

    const {manifestHash, ...value} = manifest;
    const units = value.units.map(unit => ({
        ...unit,
        views: unit.views.map(({id, sha256, width, height, rect}) => ({id, sha256, width, height, rect})),
    }));
    if (hash(JSON.stringify({...value, units})) !== manifestHash) return false;

    const images = [];
    for (const image of native.images) {
        if (!image || typeof image !== 'object' || Array.isArray(image)) return false;
        // The earlier format omitted precisely these three location fields.
        const legacy = {...image};
        delete legacy.paragraph;
        delete legacy.relationshipId;
        delete legacy.alternateRelationships;
        images.push(legacy);
    }
    return hash(JSON.stringify({...value, nativeVerification: {...native, images}, units})) === previousHash;
}
