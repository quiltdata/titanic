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

// Table context for operations - simplified to contain only runtime data
// Configuration data (databases, buckets) should come from Config instead
export interface TableContext {
    registryName: string;  // Runtime data extracted from source table name
}

// Factory function for creating table contexts
export function createTableContext(registryName: string): TableContext {
    return {
        registryName,
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
    USE_S3_TABLE?: string;  // "true" for S3 tables with partitions, "false" for Glue with WITH clause
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
