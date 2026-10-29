export interface LocalWritingTicket {readonly id: number; readonly context: string;}
export function localWritingRequestMessage(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) return fallback;
    if (error instanceof SyntaxError) return 'התשובה המקומית אינה תקינה. הטקסט נשאר זמין ואפשר לנסות שוב.';
    return ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name) ? fallback : error.message || fallback;
}
/** Request identity only. It owns no editor text, network client or persistence. */
export class LocalWritingRequest {
    private sequence = 0;
    private active: LocalWritingTicket | null = null;
    begin(context: string): LocalWritingTicket {this.active = Object.freeze({id: ++this.sequence, context}); return this.active;}
    accepts(ticket: LocalWritingTicket, context: string): boolean {return this.active === ticket && ticket.context === context;}
    finish(ticket: LocalWritingTicket): boolean {if (this.active !== ticket) return false; this.active = null; return true;}
    cancel(): void {this.active = null; ++this.sequence;}
}
