export interface IndexStats {
    totalConversations: number;
    conversationsWithSummaries: number;
    conversationsWithoutSummaries: number;
    totalExchanges: number;
    dateRange?: {
        earliest: string;
        latest: string;
    };
    projectCount: number;
    topProjects?: Array<{
        project: string;
        count: number;
    }>;
    databaseSize?: string;
    /** exchanges still on an old embedding model (re-embedded incrementally on sync) */
    staleEmbeddings?: number;
    /** conversations permanently skipped after repeated summary failures; populated by the CLI layer */
    poisonConversations?: number;
}
export declare function getIndexStats(dbPath?: string): Promise<IndexStats>;
export declare function formatStats(stats: IndexStats): string;
