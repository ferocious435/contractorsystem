export const mixedScriptTranscription = [
    'Read Hebrew prose from right to left. Keep every visible letter, including a single-letter prefix attached to a word. Before returning the text, check word beginnings against the image.',
    'Preserve the printed Hebrew plene and defective spelling, including internal vav and yod. A familiar word may be spelled differently twice in one paragraph. Inspect each occurrence separately. Check punctuation against the source at the ends of lines and around brackets.',
    'Read a continuous Latin identifier or Latin identifier range from left to right, including the digits and the separating dash. Follow its printed positions even when the surrounding sentence is Hebrew. Never sort the codes numerically.',
    'Keep a measurement and its printed unit together. Preserve which number a quotation mark belongs to and inspect the source before placing it.',
].join(' ');
