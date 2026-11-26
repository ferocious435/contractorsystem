import 'server-only';
import {createHash} from 'node:crypto';
import {record, validUuid} from '../server/ai/contracts';
import {unitReadingLiteral} from '../server/ai/visual-reading-cache.server';
import {VISUAL_READING_RULES, validReadingHash, validReadingRect, type Rect, type RegistryUnit, type UnitReading, type VerifiedUnit, type VerifiedView} from './visual-source-reading';
import {compareNumericReadings} from './visual-source-response';

const dimensionPrefix = 'DRAWING_DIMENSION ';
const drawingContexts = ['SITE_PLAN', 'CONCRETE_DETAIL', 'STEEL_DETAIL', 'WOOD_DETAIL', 'UNKNOWN'] as const;
type DrawingContext = typeof drawingContexts[number];
type Observation = {label: string; printed: string; target: string; targetQuote?: string; context: DrawingContext};
export type VerifiedDrawingDimension = Observation & {viewId: string; rect: Rect};

export const isDrawingDimensionNote = (note: string) => note.trimStart().startsWith(dimensionPrefix);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const dimensionLabel = /^\d{1,12}(?:[.,]\d{1,8})?$/u;
const wordCharacter = /[\p{L}\p{M}\p{N}]/u;
const cleanLine = (value: unknown, max: number): value is string => typeof value === 'string'
    && value.length > 0 && value.length <= max && value.trim() === value && !/[\r\n]/u.test(value);

export function drawingDimensionNotesHash(proof: Pick<VerifiedView, 'reading' | 'confirmation' | 'method'>) {
    if (proof.method !== 'visual-double-pass' || !proof.confirmation) return undefined;
    const primary = proof.reading.nonBlockingNotes?.filter(isDrawingDimensionNote) ?? [];
    const confirmation = proof.confirmation.nonBlockingNotes?.filter(isDrawingDimensionNote) ?? [];
    if (!primary.length && !confirmation.length) return undefined;
    return sha256(JSON.stringify([primary, confirmation]));
}

function containsLiteralPhrase(text: string, phrase: string) {
    for (const line of text.split(/\r?\n/u)) {
        for (let start = line.indexOf(phrase); start >= 0; start = line.indexOf(phrase, start + phrase.length)) {
            if (!wordCharacter.test(line[start - 1] ?? '') && !wordCharacter.test(line[start + phrase.length] ?? '')) return true;
        }
    }
    return false;
}

function hasUniqueLiteralLabel(text: string, label: string) {
    const values = text.matchAll(/[+\-−±]?\d+(?:[.,/]\d+)*/gu);
    const matches = [...values].filter((value) => value[0] === label);
    if (matches.length !== 1) return false;
    const start = matches[0].index;
    // A dimension must have its own literal number. Signs in elevation labels and
    // digits embedded in larger numbers or drawing identifiers do not qualify.
    const preceding = text.slice(text.lastIndexOf('\n', start - 1) + 1, start);
    return !/[\p{L}\p{M}\p{N}.,/]$/u.test(preceding) && !/[+\-−±]\s*$/u.test(preceding);
}

function observedDimensions(reading: UnitReading) {
    const observations = new Map<string, Observation | null>();
    if (reading.contentRole !== 'CONTENT' || reading.uncertainties.length) return observations;
    for (const note of reading.nonBlockingNotes ?? []) {
        if (!isDrawingDimensionNote(note) || note.length > 1024) continue;
        let value: unknown;
        try { value = JSON.parse(note.trimStart().slice(dimensionPrefix.length)); } catch { continue; }
        if (!record(value) || typeof value.label !== 'string' || !dimensionLabel.test(value.label)) continue;
        const {label, printed, target, targetQuote, context, role} = value;
        if (observations.has(label) || role !== 'LINEAR_DIMENSION' || !drawingContexts.includes(context as DrawingContext)
            || !cleanLine(printed, 50) || !cleanLine(target, 180) || !hasUniqueLiteralLabel(printed, label)
            || !hasUniqueLiteralLabel(reading.text, label) || !containsLiteralPhrase(reading.text, printed)
            || targetQuote !== undefined && (!cleanLine(targetQuote, 180) || !containsLiteralPhrase(reading.text, targetQuote))) {
            observations.set(label, null);
            continue;
        }
        observations.set(label, {label, printed, target, ...(targetQuote === undefined ? {} : {targetQuote}), context: context as DrawingContext});
    }
    return observations;
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function sameImage(a: VerifiedView['readingImage'], b: VerifiedView['readingImage'], rect: Rect) {
    return a && b && validReadingHash(a.sha256) && a.sha256 === b.sha256
        && Number.isSafeInteger(a.width) && a.width > 0 && a.width === b.width
        && Number.isSafeInteger(a.height) && a.height > 0 && a.height === b.height
        && validReadingRect(a.rect) && validReadingRect(b.rect) && sameRect(a.rect, rect) && sameRect(b.rect, rect);
}

/** The caller binds this inventory entry to the current owned document and revision. */
export function getVerifiedDrawingDimensions(savedUnit: unknown, registry: RegistryUnit): VerifiedDrawingDimension[] {
    try {
        if (!record(savedUnit)) return [];
        const unit = savedUnit as unknown as VerifiedUnit;
        if (unit.unitId !== registry.id || !validReadingHash(unit.inputHash) || unit.inputHash !== registry.inputHash
            || unit.textHash !== registry.textHash || unit.textHash !== sha256(unit.text)
            || !unit.createdBy || !validUuid(unit.createdBy.jobId) || unit.createdBy.rulesVersion !== VISUAL_READING_RULES
            || !Number.isSafeInteger(unit.createdBy.profileRevision) || unit.createdBy.profileRevision < 1
            || unit.contentRole === 'BRANDING_ONLY' || registry.contentRole === 'BRANDING_ONLY') return [];

        const dimensions = new Map<string, VerifiedDrawingDimension>();
        for (const proof of unit.views) {
            if (proof.method !== 'visual-double-pass' || !proof.confirmation
                || proof.reading.unitId !== unit.unitId || proof.confirmation.unitId !== unit.unitId
                || unit.views.filter(view => view.viewId === proof.viewId).length !== 1) continue;
            const views = registry.views.filter(view => view.id === proof.viewId);
            const registered = registry.verifiedViews.filter(view => view.viewId === proof.viewId);
            if (views.length !== 1 || registered.length !== 1) continue;
            const [{rect, sha256: imageHash}] = views;
            const [peer] = registered;
            if (!validReadingRect(rect) || !validReadingHash(imageHash) || proof.imageHash !== imageHash || peer.imageHash !== imageHash
                || peer.method !== proof.method || peer.textHash !== proof.textHash || peer.confirmationHash !== proof.confirmationHash
                || !validReadingHash(proof.drawingDimensionNotesHash) || proof.drawingDimensionNotesHash !== peer.drawingDimensionNotesHash
                || proof.drawingDimensionNotesHash !== drawingDimensionNotesHash(proof)
                || !sameImage(proof.readingImage, peer.readingImage, rect) || !sameImage(proof.confirmationImage, peer.confirmationImage, rect)
                || ![proof.reading.viewId, proof.confirmation.viewId].every(id => registry.views.some(view => view.id === id && validReadingRect(view.rect) && sameRect(view.rect, rect)))
                || sha256(unitReadingLiteral(proof.reading)) !== proof.textHash
                || sha256(unitReadingLiteral(proof.confirmation)) !== proof.confirmationHash
                || !compareNumericReadings(proof.reading, proof.confirmation).matched) continue;

            const primary = observedDimensions(proof.reading);
            const confirmation = observedDimensions(proof.confirmation);
            for (const [label, observation] of primary) {
                if (!observation || JSON.stringify(observation) !== JSON.stringify(confirmation.get(label))) continue;
                const id = JSON.stringify({observation, rect});
                if (!dimensions.has(id)) dimensions.set(id, {...observation, viewId: proof.viewId, rect});
            }
        }
        return [...dimensions.values()];
    } catch {
        return [];
    }
}
