import { Context, SQSEvent } from "aws-lambda";
import { GlueClient } from "@aws-sdk/client-glue";
import { GetTableCommand, GetTablesCommand } from "@aws-sdk/client-glue";
import { AthenaClient } from "@aws-sdk/client-athena";
import {
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";

const glueClient = new GlueClient({
    maxAttempts: 3,
});
const athenaClient = new AthenaClient({
    maxAttempts: 3,
});

async function waitForQueryCompletion(
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

type HandlerResponse = {
    message: string;
    numTables: number;
} | undefined;

export async function handler(
    event: SQSEvent,
    context: Context,
): Promise<HandlerResponse> {
    const databaseName = process.env.DATABASE_NAME;
    const targetBucket = process.env.TARGET_BUCKET;
    console.log("Environment variables:", {
        databaseName,
        targetBucket,
    });

    if (!databaseName || !targetBucket) {
        throw new Error(
            "Missing required environment variables DATABASE_NAME or TARGET_BUCKET",
        );
    }

    try {
        // Get all tables in the database
        console.log("Fetching tables from Glue database:", databaseName);
        const tablesResponse = await glueClient.send(
            new GetTablesCommand({
                DatabaseName: databaseName,
            }),
        );

        if (!tablesResponse.TableList) {
            throw new Error(
                `Unable to list tables in database ${databaseName}`,
            );
        }

        // Get table_prefix from SQS message if present
        const messageBody = event.Records?.[0]?.body;
        console.log("SQS message body:", messageBody);
        let tablePrefix: string | undefined;
        try {
            if (messageBody) {
                const parsedBody = JSON.parse(messageBody) as {
                    table_prefix?: string;
                };
                tablePrefix = parsedBody.table_prefix;
                console.log("Parsed table_prefix from message:", tablePrefix);
            }
        } catch (e) {
            console.warn("Failed to parse message body:", e);
        }

        // Filter for source tables (excluding the merged table)
        const sourceTables = tablesResponse.TableList?.filter((table) => {
            console.log("Checking table:", table.Name);
            if (!table.Name) return false;

            // Check if table name ends with -view
            const isView = table.Name.endsWith("-view");
            const matchesPrefix = tablePrefix
                ? table.Name.startsWith(tablePrefix)
                : true;

            return isView && matchesPrefix;
        }) || [];

        // First check if merged table exists
        // Create packages table
        const createPackagesTableQuery = `
      CREATE TABLE IF NOT EXISTS "${databaseName}"."titanic_merged_packages" (
        pkg_name STRING,
        top_hash STRING,
        timestamp STRING,
        message STRING,
        user_meta STRING,
        source_bucket STRING
      )
      WITH (
        location = 's3://${targetBucket}/merged/packages/',
        table_type = 'ICEBERG',
        format = 'PARQUET',
        partitioning = ARRAY['source_bucket']
      )`;

        // Create objects table
        const createObjectsTableQuery = `
      CREATE TABLE IF NOT EXISTS "${databaseName}"."titanic_merged_objects" (
        pkg_name STRING,
        top_hash STRING,
        timestamp STRING,
        logical_key STRING,
        physical_key STRING,
        size BIGINT,
        hash STRUCT<type:STRING,value:STRING>,
        meta STRING,
        source_bucket STRING
      )
      WITH (
        location = 's3://${targetBucket}/merged/objects/',
        table_type = 'ICEBERG',
        format = 'PARQUET',
        partitioning = ARRAY['source_bucket']
      )
    `;

        // Create packages table
        const createPackagesResponse = await athenaClient.send(
            new StartQueryExecutionCommand({
                QueryString: createPackagesTableQuery,
                ResultConfiguration: {
                    OutputLocation: `s3://${targetBucket}/athena-results/`,
                },
            }),
        );

        if (!createPackagesResponse.QueryExecutionId) {
            throw new Error(
                "Failed to get QueryExecutionId for create packages table query",
            );
        }

        await waitForQueryCompletion(createPackagesResponse.QueryExecutionId);

        // Create objects table
        const createObjectsResponse = await athenaClient.send(
            new StartQueryExecutionCommand({
                QueryString: createObjectsTableQuery,
                ResultConfiguration: {
                    OutputLocation: `s3://${targetBucket}/athena-results/`,
                },
            }),
        );

        if (!createObjectsResponse.QueryExecutionId) {
            throw new Error(
                "Failed to get QueryExecutionId for create objects table query",
            );
        }

        await waitForQueryCompletion(createObjectsResponse.QueryExecutionId);

        console.log("Source tables found:", sourceTables.map((t) => t.Name));

        // Build MERGE query for each source table
        const mergeQueries = sourceTables.map((table) => {
            const query = `
      INSERT INTO "${databaseName}"."${table.Name?.includes('packages') ? 'titanic_merged_packages' : 'titanic_merged_objects'}"
      SELECT DISTINCT
        ${table.Name?.includes('packages') ? `
        s."pkg_name",
        s."top_hash",
        s."timestamp",
        s."message",
        s."user_meta",
        s."source_bucket"` : `
        s."pkg_name",
        s."top_hash",
        s."timestamp",
        s."logical_key",
        s."physical_key",
        s."size",
        s."hash",
        s."meta",
        s."source_bucket"`}
      FROM "${databaseName}"."${table.Name}" s
      LEFT JOIN "${databaseName}"."${table.Name?.includes('packages') ? 'titanic_merged_packages' : 'titanic_merged_objects'}" t
      ON s."pkg_name" = t."pkg_name" 
      AND s."top_hash" = t."top_hash"
      AND s."source_bucket" = t."source_bucket"
      WHERE t."pkg_name" IS NULL`;

            console.log(
                "Generated merge query for table",
                table.Name,
                ":",
                query,
            );
            return query;
        });

        if (sourceTables.length > 0) {
            console.log(
                "Starting merge operations for",
                sourceTables.length,
                "tables",
            );
            // Execute each merge query sequentially
            for (const query of mergeQueries) {
                console.log("Executing query:", query);
                const queryResponse = await athenaClient.send(
                    new StartQueryExecutionCommand({
                        QueryString: query,
                        ResultConfiguration: {
                            OutputLocation:
                                `s3://${targetBucket}/athena-results/`,
                        },
                    }),
                );

                if (!queryResponse.QueryExecutionId) {
                    throw new Error(
                        "Failed to get QueryExecutionId for merge query",
                    );
                }

                console.log(
                    "Query started with execution ID:",
                    queryResponse.QueryExecutionId,
                );
                await waitForQueryCompletion(queryResponse.QueryExecutionId);
                console.log("Query completed successfully");
            }
        }

        const response = {
            message: sourceTables.length > 0
                ? "Merge queries started successfully"
                : "Created merged table (no source tables found)",
            numTables: sourceTables.length,
        };

        return response;
    } catch (error) {
        const err = error as Error;
        console.error("Error merging tables:", {
            error: err.message,
            stack: err.stack,
            databaseName,
            targetBucket,
        });
        throw err;
    }
}
