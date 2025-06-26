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
    successfulTables?: number;
    failedTables?: number;
    totalQueries?: number;
} | undefined;

// Table context for operations
export interface TableContext {
    databaseName: string;
    targetBucket: string;
    registryName: string;
    useS3Table?: boolean;  // Runtime configuration: true = S3 table with partitions, false = Iceberg table with WITH clause
}

// Factory function for creating table contexts
export function createTableContext(
    databaseName: string,
    targetBucket: string,
    registryName: string,
    useS3Table: boolean = false
): TableContext {
    return {
        databaseName,
        targetBucket,
        registryName,
        useS3Table,
    };
}

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

// Context validation utilities
export class TableContextValidator {
    static validateTableContext(context: Partial<TableContext>): ValidationResult {
        const errors: string[] = [];

        if (!context.databaseName) {
            errors.push("databaseName is required");
        }
        if (!context.targetBucket) {
            errors.push("targetBucket is required");
        }
        if (!context.registryName) {
            errors.push("registryName is required");
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static assertValidContext(context: Partial<TableContext>): asserts context is TableContext {
        const validation = this.validateTableContext(context);
        if (!validation.isValid) {
            throw new Error(`Invalid TableContext: ${validation.errors.join(", ")}`);
        }
    }
}

// Environment configuration interface
export interface EnvironmentConfig {
    DATABASE_NAME: string;
    TARGET_BUCKET: string;
    USE_S3_TABLE?: string;  // "true" for S3 tables with partitions, "false" for Iceberg with WITH clause
    LAMBDA_TIMEOUT?: string;
    QUEUE_URL?: string;
    QUILT_READ_POLICY_ARN?: string;
}

// Utility functions for validation
export class ConfigValidator {
    static validateEnvironment(): ValidationResult {
        const errors: string[] = [];
        
        if (!process.env.DATABASE_NAME) {
            errors.push("DATABASE_NAME environment variable is required");
        }
        
        if (!process.env.TARGET_BUCKET) {
            errors.push("TARGET_BUCKET environment variable is required");
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
