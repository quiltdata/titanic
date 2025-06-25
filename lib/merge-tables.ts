import { Context, EventBridgeEvent } from "aws-lambda";
import { GlueClient } from "@aws-sdk/client-glue";
import { GetTableCommand, GetTablesCommand } from "@aws-sdk/client-glue";
import { GetTablesCommandOutput } from "@aws-sdk/client-glue";
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

// EventBridge event detail structure
interface PackageEventDetail {
    version: string;
    type: string;
    bucket: string;
    handle: string;
    topHash: string;
}

type HandlerResponse = {
    message: string;
    numTables: number;
} | undefined;

export async function handler(
    event: EventBridgeEvent<string, PackageEventDetail>,
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
        // Extract details from EventBridge event
        console.log("EventBridge event:", JSON.stringify(event, null, 2));
        const { bucket, handle, topHash } = event.detail;
        console.log("Event details:", { bucket, handle, topHash });

        // Get all tables in the database
        console.log("Fetching tables from Glue database:", databaseName);
        let allTables = [];
        let nextToken = undefined;

        do {
            const tablesResponse: GetTablesCommandOutput = await glueClient.send(
                new GetTablesCommand({
                    DatabaseName: databaseName,
                    NextToken: nextToken,
                })
            );
            if (!tablesResponse.TableList) {
                throw new Error(
                    `Unable to list tables in database ${databaseName}`,
                );
            }
            allTables.push(...tablesResponse.TableList);
            nextToken = tablesResponse.NextToken;
        } while (nextToken);

        // Derive table prefix from bucket name (source registry name)
        const tablePrefix = bucket?.replace(/[^a-zA-Z0-9]/g, '_');
        console.log("Derived table_prefix from bucket:", tablePrefix);

        // Filter for source tables (excluding the merged table)
        const sourceTables = allTables?.filter((table) => {
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
            const isPackagesView = table.Name?.includes('packages-view');
            const registryName = sourceBucketFromTableName(table.Name!);
            
            if (isPackagesView) {
                // Handle package revisions and tags
                const revisionQuery = `
                INSERT INTO "${databaseName}"."package_revision" (registry, pkg_name, top_hash, timestamp, message, metadata)
                SELECT DISTINCT
                  '${registryName}' AS registry,
                  s.pkg_name,
                  s.top_hash,
                  from_unixtime(CAST(s.timestamp AS bigint)) AS timestamp,
                  s.message,
                  s.user_meta AS metadata
                FROM "${databaseName}"."${table.Name}" s
                LEFT JOIN "${databaseName}"."package_revision" t
                  ON s.pkg_name = t.pkg_name
                  AND s.top_hash = t.top_hash
                  AND t.registry = '${registryName}'
                WHERE t.pkg_name IS NULL
                  AND s.timestamp != 'latest'`;

                const tagQuery = `
                INSERT INTO "${databaseName}"."package_tag" (registry, pkg_name, tag_name, top_hash)
                SELECT DISTINCT
                  '${registryName}' AS registry,
                  s.pkg_name,
                  s.timestamp AS tag_name,
                  s.top_hash
                FROM "${databaseName}"."${table.Name}" s
                LEFT JOIN "${databaseName}"."package_tag" t
                  ON s.pkg_name = t.pkg_name
                  AND s.timestamp = t.tag_name
                  AND t.registry = '${registryName}'
                WHERE s.timestamp = 'latest'
                  AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)`;

                return [revisionQuery, tagQuery];
            } else {
                // Handle package entries
                const entryQuery = `
                INSERT INTO "${databaseName}"."package_entry" (registry, top_hash, logical_key, physical_key, multihash, size, metadata)
                SELECT DISTINCT
                  '${registryName}' AS registry,
                  s.top_hash,
                  s.logical_key,
                  s.physical_key,
                  concat(
                    CASE s.hash.type
                      WHEN 'SHA256' THEN '1220'
                      WHEN 'sha2-256-chunked' THEN 'b150'
                      ELSE '0000'
                    END,
                    s.hash.value
                  ) AS multihash,
                  s.size,
                  s.meta AS metadata
                FROM "${databaseName}"."${table.Name}" s
                LEFT JOIN "${databaseName}"."package_entry" t
                  ON s.logical_key = t.logical_key
                  AND s.meta = t.metadata
                  AND s.top_hash = t.top_hash
                  AND t.registry = '${registryName}'
                WHERE t.logical_key IS NULL`;

                return [entryQuery];
            }
        }).flat();

        // Helper to check if a table exists
        async function tableExists(tableName: string): Promise<boolean> {
            const tablesResponse: GetTablesCommandOutput = await glueClient.send(
                new GetTablesCommand({
                    DatabaseName: databaseName,
                    Expression: tableName,
                })
            );
            return (tablesResponse.TableList || []).some(t => t.Name === tableName);
        }

        // Helper to create table using CTAS from a representative view
        async function createTableWithCTAS(targetTable: string, sourceView: string, schema: string) {
            const ctasQuery = `
                CREATE TABLE IF NOT EXISTS "${databaseName}"."${targetTable}"
                ${schema}
                AS SELECT * FROM "${databaseName}"."${sourceView}" WHERE false
            `;
            const response = await athenaClient.send(
                new StartQueryExecutionCommand({
                    QueryString: ctasQuery,
                    ResultConfiguration: {
                        OutputLocation: `s3://${targetBucket}/athena-results/`,
                    },
                })
            );
            if (!response.QueryExecutionId) {
                throw new Error(`Failed to get QueryExecutionId for CTAS for ${targetTable}`);
            }
            await waitForQueryCompletion(response.QueryExecutionId);
        }

        // Find representative views for each table type
        const packagesView = sourceTables.find(t => t.Name?.includes('packages-view'))?.Name;
        const entriesView = sourceTables.find(t => t.Name?.includes('objects-view'))?.Name;

        // Create package_revision table if needed
        if (packagesView && !(await tableExists('package_revision'))) {
            console.log('Creating package_revision table using CTAS from', packagesView);
            const revisionSchema = `
                WITH (
                    format = 'PARQUET',
                    write_compression = 'SNAPPY',
                    location = 's3://${targetBucket}/package_revision/',
                    table_type = 'ICEBERG',
                    is_external = false
                )
                PARTITIONED BY (
                    registry,
                    bucket(8, pkg_name),
                    bucket(8, top_hash)
                )`;
            await createTableWithCTAS('package_revision', packagesView, revisionSchema);
        }

        // Create package_tag table if needed
        if (packagesView && !(await tableExists('package_tag'))) {
            console.log('Creating package_tag table using CTAS from', packagesView);
            const tagSchema = `
                WITH (
                    format = 'PARQUET',
                    write_compression = 'SNAPPY',
                    location = 's3://${targetBucket}/package_tag/',
                    table_type = 'ICEBERG',
                    is_external = false
                )
                PARTITIONED BY (
                    registry,
                    tag_name,
                    bucket(8, pkg_name)
                )`;
            await createTableWithCTAS('package_tag', packagesView, tagSchema);
        }

        // Create package_entry table if needed
        if (entriesView && !(await tableExists('package_entry'))) {
            console.log('Creating package_entry table using CTAS from', entriesView);
            const entrySchema = `
                WITH (
                    format = 'PARQUET',
                    write_compression = 'SNAPPY',
                    location = 's3://${targetBucket}/package_entry/',
                    table_type = 'ICEBERG',
                    is_external = false
                )
                PARTITIONED BY (
                    registry,
                    bucket(64, physical_key)
                )`;
            await createTableWithCTAS('package_entry', entriesView, entrySchema);
        }

        // Check for empty source tables
        if (sourceTables.length === 0) {
            return {
                message: "Created tables (no source tables found)",
                numTables: 0,
            };
        }

        // Execute merge queries
        console.log(
            "Starting merge operations for",
            mergeQueries.length,
            "queries",
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
            message: "Merge queries completed successfully",
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