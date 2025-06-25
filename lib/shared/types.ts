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
    enablePartitioning?: boolean;  // Runtime configuration for partitioning
}

// Enhanced error types for better error handling
export interface TableOperationError extends Error {
    operation: string;
    tableName?: string;
    databaseName?: string;
    queryId?: string;
}

// Configuration validation result
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

// Environment configuration interface
export interface EnvironmentConfig {
    DATABASE_NAME: string;
    TARGET_BUCKET: string;
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
    
    static validateTableContext(context: Partial<TableContext>): ValidationResult {
        const errors: string[] = [];
        
        if (!context.databaseName) {
            errors.push("databaseName is required in table context");
        }
        
        if (!context.targetBucket) {
            errors.push("targetBucket is required in table context");
        }
        
        if (!context.registryName) {
            errors.push("registryName is required in table context");
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
