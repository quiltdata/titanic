import { AthenaClient } from "@aws-sdk/client-athena";
import {
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { GlueClient, GetTablesCommand, GetTablesCommandOutput } from "@aws-sdk/client-glue";

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

export async function tableExists(databaseName: string, tableName: string): Promise<boolean> {
    const tablesResponse: GetTablesCommandOutput = await glueClient.send(
        new GetTablesCommand({
            DatabaseName: databaseName,
            Expression: tableName,
        })
    );
    return (tablesResponse.TableList || []).some(t => t.Name === tableName);
}

export async function executeQuery(query: string, targetBucket: string): Promise<void> {
    console.log("Executing query:", query);
    const queryResponse = await athenaClient.send(
        new StartQueryExecutionCommand({
            QueryString: query,
            ResultConfiguration: {
                OutputLocation: `s3://${targetBucket}/athena-results/`,
            },
        }),
    );

    if (!queryResponse.QueryExecutionId) {
        throw new Error("Failed to get QueryExecutionId for query");
    }

    console.log("Query started with execution ID:", queryResponse.QueryExecutionId);
    await waitForQueryCompletion(queryResponse.QueryExecutionId);
    console.log("Query completed successfully");
}

/**
 * Enhanced query execution with retry logic
 */
export async function executeQueryWithRetry(
    query: string, 
    targetBucket: string,
    maxRetries: number = 3,
    retryDelay: number = 1000
): Promise<void> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await executeQuery(query, targetBucket);
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
