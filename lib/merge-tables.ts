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

const sourceBucketFromTableName = (name: string) => name.replace(/_(objects|packages)-view$/, "");

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


        console.log("Source tables found:", sourceTables.map((t) => t.Name));

        // Build MERGE query for each source table
        const mergeQueries = sourceTables.map((table) => {
            const query = `
      INSERT INTO "${databaseName}"."${table.Name?.includes('packages') ? 'titanic_merged_packages' : 'titanic_merged_objects'}"
      SELECT DISTINCT
        ${table.Name?.includes('packages') ? `
        s.pkg_name,
        s.top_hash,
        s.timestamp,
        s.message,
        s.user_meta,
        '${sourceBucketFromTableName(table.Name!)}' AS source_bucket` : `
        s.pkg_name,
        s.top_hash,
        s.timestamp,
        s.logical_key,
        s.physical_key,
        s.size,
        s.hash,
        s.meta,
        '${sourceBucketFromTableName(table.Name!)}' AS source_bucket`}
      FROM "${databaseName}"."${table.Name}" s
      LEFT JOIN "${databaseName}"."${table.Name?.includes('packages') ? 'titanic_merged_packages' : 'titanic_merged_objects'}" t
      ON s.pkg_name = t.pkg_name 
      AND s.top_hash = t.top_hash
      AND '${sourceBucketFromTableName(table.Name!)}' = t.source_bucket
      WHERE t.pkg_name IS NULL`;

            console.log(
                "Generated merge query for table",
                table.Name,
                ":",
                query,
            );
            return query;
        });

        // Clean up existing data and create tables
        const cleanupPackagesQuery = `
            DELETE FROM "${databaseName}"."titanic_merged_packages"
            WHERE true`;

        const cleanupObjectsQuery = `
            DELETE FROM "${databaseName}"."titanic_merged_objects"
            WHERE true`;

        // Try to clean up existing data first
        try {
            const cleanupPackagesResponse = await athenaClient.send(
                new StartQueryExecutionCommand({
                    QueryString: cleanupPackagesQuery,
                    ResultConfiguration: {
                        OutputLocation: `s3://${targetBucket}/athena-results/`,
                    },
                }),
            );
            if (cleanupPackagesResponse.QueryExecutionId) {
                await waitForQueryCompletion(cleanupPackagesResponse.QueryExecutionId);
            }
        } catch (e) {
            console.log("No existing packages table to clean up");
        }

        try {
            const cleanupObjectsResponse = await athenaClient.send(
                new StartQueryExecutionCommand({
                    QueryString: cleanupObjectsQuery,
                    ResultConfiguration: {
                        OutputLocation: `s3://${targetBucket}/athena-results/`,
                    },
                }),
            );
            if (cleanupObjectsResponse.QueryExecutionId) {
                await waitForQueryCompletion(cleanupObjectsResponse.QueryExecutionId);
            }
        } catch (e) {
            console.log("No existing objects table to clean up");
        }

        // Create tables if they don't exist
        const createPackagesQuery = `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."titanic_merged_packages"
            WITH (
                format = 'PARQUET',
                write_compression = 'SNAPPY',
                location = 's3://${targetBucket}/merged/packages/',
                table_type = 'ICEBERG',
                is_external = false
            )
            AS SELECT
                CAST(NULL AS VARCHAR) as pkg_name,
                CAST(NULL AS VARCHAR) as top_hash,
                CAST(NULL AS VARCHAR) as timestamp,
                CAST(NULL AS VARCHAR) as message,
                CAST(NULL AS VARCHAR) as user_meta,
                CAST(NULL AS VARCHAR) as source_bucket,
            WHERE false
        `;

        const createObjectsQuery = `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."titanic_merged_objects"
            WITH (
                format = 'PARQUET',
                write_compression = 'SNAPPY',
                location = 's3://${targetBucket}/merged/objects/',
                table_type = 'ICEBERG',
                is_external = false
            )
            AS SELECT
                CAST(NULL AS VARCHAR) as pkg_name,
                CAST(NULL AS VARCHAR) as top_hash,
                CAST(NULL AS VARCHAR) as timestamp,
                CAST(NULL AS VARCHAR) as logical_key,
                CAST(NULL AS VARCHAR) as physical_key,
                CAST(NULL AS BIGINT) as size,
                CAST(NULL AS ROW(type VARCHAR, value VARCHAR)) as hash,
                CAST(NULL AS VARCHAR) as meta,
                CAST(NULL AS VARCHAR) as source_bucket,
            WHERE false
        `;

        // Create packages table
        const createPackagesResponse = await athenaClient.send(
            new StartQueryExecutionCommand({
                QueryString: createPackagesQuery,
                ResultConfiguration: {
                    OutputLocation: `s3://${targetBucket}/athena-results/`,
                },
            }),
        );

        if (!createPackagesResponse.QueryExecutionId) {
            throw new Error("Failed to get QueryExecutionId for create packages table");
        }

        await waitForQueryCompletion(createPackagesResponse.QueryExecutionId);

        // Create objects table
        const createObjectsResponse = await athenaClient.send(
            new StartQueryExecutionCommand({
                QueryString: createObjectsQuery,
                ResultConfiguration: {
                    OutputLocation: `s3://${targetBucket}/athena-results/`,
                },
            }),
        );

        if (!createObjectsResponse.QueryExecutionId) {
            throw new Error("Failed to get QueryExecutionId for create objects table");
        }

        await waitForQueryCompletion(createObjectsResponse.QueryExecutionId);

        // Check for empty source tables
        if (sourceTables.length === 0) {
            return {
                message: "Created merged table (no source tables found)",
                numTables: 0,
            };
        }

        // Execute merge queries
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
                        OutputLocation: `s3://${targetBucket}/athena-results/`,
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

        return {
            message: "Merge queries started successfully",
            numTables: sourceTables.length,
        };
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
