/* tslint:disable */
/* eslint-disable */

export class VaporettoTokenizer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a new tokenizer from a zstd-compressed or raw model buffer.
     */
    constructor(model_data: Uint8Array);
    /**
     * Tokenize a string and return space-separated tokens.
     */
    tokenize(text: string): string;
    /**
     * Return token surfaces as a JS array of strings.
     */
    tokenize_to_array(text: string): Array<any>;
}
