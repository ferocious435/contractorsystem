declare module "word-extractor" {
    export type WordExtractedDocument = {
        getBody(): string;
        getFootnotes(): string;
        getEndnotes(): string;
        getHeaders(options?: { includeFooters?: boolean }): string;
        getFooters(): string;
        getAnnotations(): string;
        getTextboxes(options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string;
    };

    export default class WordExtractor {
        extract(input: string | Buffer): Promise<WordExtractedDocument>;
    }
}
