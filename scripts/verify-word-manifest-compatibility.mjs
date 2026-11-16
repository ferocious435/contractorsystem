import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {matchesLegacyWordManifestHash} from '../src/utils/word-manifest-compatibility.ts';

const hash = value => createHash('sha256').update(value).digest('hex');

function digest(manifest) {
    const {manifestHash, ...content} = manifest;
    const units = content.units.map(unit => ({
        ...unit,
        views: unit.views.map(({id, sha256, width, height, rect}) => ({id, sha256, width, height, rect})),
    }));
    return hash(JSON.stringify({...content, units}));
}

function fixture() {
    const sourceHash = hash('same Word bytes');
    const imageHash = hash('image');
    const location = {part: 'word/document.xml', anchor: 'word/document.xml#r1:1', mediaName: 'word/media/image1.png'};
    const image = {
        ...location, paragraph: 2, relationshipId: 'r1', alternateRelationships: ['r2'], sha256: imageHash,
        status: 'UNREADABLE', confidence: 0, numericReviewRequired: false, reason: 'OCR_NO_READABLE_BODY',
    };
    const unit = {
        id: 'docx:' + imageHash, kind: 'DOCX_IMAGE', locations: [location], contextText: 'Approval 123', localText: '',
        views: [{
            id: 'image:' + imageHash, sha256: imageHash, bytes: new Uint8Array([1, 2]), width: 2, height: 1,
            rect: {x: 0, y: 0, width: 1, height: 1},
        }],
    };
    const manifest = {
        sourceHash, format: 'DOCX', nativeText: 'Approval 123',
        nativeVerification: {
            version: 'docx-image-coverage-v1', sourceHash, complete: false, expectedImageReferences: 1, images: [image], issues: [],
        },
        units: [unit], issues: [], assembly: [{kind: 'native', text: 'Approval 123'}, {kind: 'unit', unitId: unit.id}],
    };
    manifest.manifestHash = digest(manifest);
    const legacy = structuredClone(manifest);
    for (const field of ['paragraph', 'relationshipId', 'alternateRelationships']) delete legacy.nativeVerification.images[0][field];
    return {manifest, oldHash: digest(legacy)};
}

test('recognizes only the exact former Word metadata serialization', () => {
    const {manifest, oldHash} = fixture();
    assert.notEqual(manifest.manifestHash, oldHash);
    assert.equal(matchesLegacyWordManifestHash(manifest, oldHash), true);
    assert.equal(matchesLegacyWordManifestHash(manifest, '0'.repeat(64)), false);
    assert.equal(matchesLegacyWordManifestHash({...manifest, format: 'PDF'}, oldHash), false);
});

test('source, text, numbers, assembly, image scope and unknown extensions remain hashed', () => {
    const mutations = [
        doc => { doc.sourceHash = hash('another file'); },
        doc => { doc.nativeText = 'Approval 124'; },
        doc => { doc.assembly[0].text = 'Approval 124'; },
        doc => { doc.units[0].contextText = 'Approval 124'; },
        doc => { doc.units[0].locations[0].part = 'word/footer.xml'; },
        doc => { doc.units[0].views[0].sha256 = hash('other pixels'); },
        doc => { doc.nativeVerification.images[0].sha256 = hash('other pixels'); },
        doc => { doc.nativeVerification.images[0].unknownExtension = 'retain me'; },
        doc => { doc.nativeVerification.extension = {scope: 'other'}; },
        doc => { doc.units.push(structuredClone(doc.units[0])); },
    ];
    for (const mutate of mutations) {
        const {manifest, oldHash} = fixture();
        mutate(manifest);
        assert.equal(matchesLegacyWordManifestHash(manifest, oldHash), false);
        manifest.manifestHash = digest(manifest);
        assert.equal(matchesLegacyWordManifestHash(manifest, oldHash), false);
    }
});

test('malformed former digest or native inventory is not recognized', () => {
    const {manifest, oldHash} = fixture();
    for (const candidate of ['', null, oldHash.toUpperCase(), oldHash.slice(1)]) {
        assert.equal(matchesLegacyWordManifestHash(manifest, candidate), false);
    }
    for (const nativeVerification of [null, [], {version: 'other', images: []}, {version: 'docx-image-coverage-v1', images: [null]}]) {
        assert.equal(matchesLegacyWordManifestHash({...manifest, nativeVerification}, oldHash), false);
    }
});
