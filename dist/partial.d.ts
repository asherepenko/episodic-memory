export interface PartialState {
    version: number;
    totalChunks: number;
    chunkSummaries: string[];
    totalExchanges: number;
    lastUpdated: string;
}
export declare function partialPathFor(jsonlPath: string): string;
export declare function loadPartial(partialPath: string, expectedTotalChunks: number, expectedExchanges: number): string[];
export declare function savePartial(partialPath: string, totalChunks: number, chunkSummaries: string[], totalExchanges: number): void;
export declare function clearPartial(partialPath: string): void;
