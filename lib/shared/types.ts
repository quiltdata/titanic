// Shared type definitions

// Column definitions for table schemas - simple name to type mapping
export type ColumnDefinitions = Record<string, string>;

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
    successfulTables?: number;
    failedTables?: number;
    totalQueries?: number;
} | undefined;

// Enhanced error types for better error handling
export interface TableOperationError extends Error {
    operation: string;
    tableName?: string;
    databaseName?: string;
    queryId?: string;
}

// Validation result type
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}
