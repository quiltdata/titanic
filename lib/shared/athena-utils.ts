import { AthenaClient } from "@aws-sdk/client-athena";
import {
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { GlueClient, GetTablesCommand, GetTablesCommandOutput } from "@aws-sdk/client-glue";
import { Config } from './config';

export const glueClient = new GlueClient({
    maxAttempts: 3,
});

export const athenaClient = new AthenaClient({
    maxAttempts: 3,
});

export async function waitForQueryCompletion(
    queryExecutionId: string,
    maxAttempts: number = 30,
): Promise<void> {
    let attempts = 0;
    while (true) {
        const queryExecution = await athenaClient.send(
            new GetQueryExecutionCommand({
                QueryExecutionId: queryExecutionId,
            }),
        );

        const state = queryExecution.QueryExecution?.Status?.State;

        if (state === QueryExecutionState.SUCCEEDED) {
            return;
        }

        if (
            state === QueryExecutionState.FAILED ||
            state === QueryExecutionState.CANCELLED
        ) {
            throw new Error(
                `Query failed: ${queryExecution.QueryExecution?.Status?.StateChangeReason}`,
            );
        }

        attempts++;
        if (attempts >= maxAttempts) {
            throw new Error(`Query timed out after ${maxAttempts} attempts`);
        }
        // Wait 2 seconds before checking again
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

export async function tableExists(config: Config, tableName: string): Promise<boolean> {
    const tablesResponse: GetTablesCommandOutput = await glueClient.send(
        new GetTablesCommand({
            DatabaseName: config.getReadDatabaseName(),
            Expression: tableName,
        })
    );
    return (tablesResponse.TableList || []).some(t => t.Name === tableName);
}

export async function executeQuery(
    query: string,
    config: Config
): Promise<void> {
    console.log("Executing query:", query);

    try {
        const resultsBucket = config.getResultsBucket();
        const databaseName = config.useS3Table
            ? config.getWriteDatabaseName()
            : config.getReadDatabaseName();

        const queryExecutionContext: any = {
            Database: databaseName,
        };

        const queryExecutionCommand: StartQueryExecutionCommand = new StartQueryExecutionCommand({
            QueryString: query,
            QueryExecutionContext: queryExecutionContext,
            ResultConfiguration: {
                OutputLocation: `s3://${resultsBucket}/athena-results/`,
            },
        });

        const queryResponse = await athenaClient.send(queryExecutionCommand);

        if (!queryResponse.QueryExecutionId) {
            throw new Error("Failed to get QueryExecutionId for query");
        }

        console.log("Query started with execution ID:", queryResponse.QueryExecutionId);
        await waitForQueryCompletion(queryResponse.QueryExecutionId);
        console.log("Query completed successfully");
    } catch (error) {
        const err = error as Error;
        console.error("Query execution failed:", {
            error: err.message,
            query: query.substring(0, 200) + (query.length > 200 ? "..." : ""),
        });
        throw err;
    }
}

/**
 * Enhanced query execution with retry logic
 */
export async function executeQueryWithRetry(
    query: string,
    config: Config,
    maxRetries: number = 3,
    retryDelay: number = 1000
): Promise<void> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await executeQuery(query, config);
            return; // Success, exit retry loop
        } catch (error) {
            lastError = error as Error;
            console.warn(`Query attempt ${attempt} failed:`, lastError.message);
            
            if (attempt < maxRetries) {
                console.log(`Retrying in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                retryDelay *= 2; // Exponential backoff
            }
        }
    }
    
    throw new Error(`Query failed after ${maxRetries} attempts: ${lastError!.message}`);
}

/**
 * Validate query syntax before execution (basic validation)
 */
export function validateQuery(query: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Basic SQL injection protection
    const suspiciousPatterns = [
        /;\s*DROP\s+/i,
        /;\s*DELETE\s+/i,
        /;\s*TRUNCATE\s+/i,
        /;\s*ALTER\s+/i
    ];
    
    for (const pattern of suspiciousPatterns) {
        if (pattern.test(query)) {
            errors.push(`Potentially dangerous SQL pattern detected: ${pattern.source}`);
        }
    }
    
    // Ensure query contains expected table operations
    if (!query.toLowerCase().includes('create table') && 
        !query.toLowerCase().includes('insert into')) {
        errors.push("Query must be a CREATE TABLE or INSERT INTO statement");
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

export const sourceBucketFromTableName = (name: string) => name.replace(/_(objects|packages)-view$/, "");

/**
 * Drop all Titanic tables function
 */
export async function dropAllTitanicTables(config: Config): Promise<void> {
    const tables = ['package_revision', 'package_tag', 'package_entry'];
    console.log('Dropping all Titanic tables for clean deployment...');
    
    for (const tableName of tables) {
        try {
            const query = config.dropTableQuery(tableName);
            console.log(`Dropping table: ${query}`);
            await executeQuery(query, config);
            console.log(`Successfully dropped table ${tableName}`);
        } catch (error) {
            const err = error as Error;
            console.log(`Note: Could not drop table ${tableName} (may not exist):`, err.message);
        }
    }

    await config.createEmptyTables();
}


