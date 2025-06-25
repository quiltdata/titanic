// Shared type definitions

// EventBridge event detail structure
export interface PackageEventDetail {
    version: string;
    type: string;
    bucket: string;
    handle: string;
    topHash: string;
}

export type HandlerResponse = {
    message: string;
    numTables: number;
} | undefined;

// Table context for operations
export interface TableContext {
    databaseName: string;
    targetBucket: string;
    registryName: string;
}
