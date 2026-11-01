import {createRequire} from 'node:module';
import type {PDFParse} from 'pdf-parse';

/** Share the installed parser with native extraction; never load a second PDF engine. */
export async function loadPdfParse():Promise<typeof PDFParse> {
    const requireFromHere=createRequire(import.meta.url);
    return (requireFromHere('pdf-parse') as {PDFParse:typeof PDFParse}).PDFParse;
}
