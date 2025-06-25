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

export const sourceBucketFromTableName = (name: string) => name.replace(/_(objects|packages)-view$/, "");
