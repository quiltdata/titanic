import { Context } from "aws-lambda";
import { GlueClient, GetTablesCommand, Table } from "@aws-sdk/client-glue";
import { AthenaClient, GetQueryExecutionCommand, QueryExecutionState, StartQueryExecutionCommand } from "@aws-sdk/client-athena";

const glueClient = new GlueClient({ maxAttempts: 3 });
const athenaClient = new AthenaClient({ maxAttempts: 3 });

async function waitForQueryCompletion(queryExecutionId: string, maxAttempts: number = 30): Promise<void> {
    let attempts = 0;
    while (true) {
        const queryExecution = await athenaClient.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
        const state = queryExecution.QueryExecution?.Status?.State;

        if (state === QueryExecutionState.SUCCEEDED) {
            return;
        }

        if (state === QueryExecutionState.FAILED || state === QueryExecutionState.CANCELLED) {
            throw new Error(`Query failed: ${queryExecution.QueryExecution?.Status?.StateChangeReason}`);
        }

        attempts++;
        if (attempts >= maxAttempts) {
            throw new Error(`Query timed out after ${maxAttempts} attempts`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

const sourceBucketFromTableName = (name: string) => name.replace(/_(objects|packages)-view$/, "");

export async function handler(event: any, context: Context): Promise<{ message: string; numTables: number } | undefined> {
    const databaseName = process.env.DATABASE_NAME;
    const targetBucket = process.env.TARGET_BUCKET;

    if (!databaseName || !targetBucket) {
        throw new Error("Missing required environment variables DATABASE_NAME or TARGET_BUCKET");
    }

    try {
        const allTables = await getAllTables(databaseName);
        const tablePrefix = event.detail?.bucket;
        const sourceTables = allTables.filter((table) => isSourceTable(table.Name, tablePrefix));

        if (sourceTables.length === 0) {
            return { message: "Created merged table (no source tables found)", numTables: 0 };
        }

        await ensureMergedTablesExist(databaseName, targetBucket, sourceTables);

        const mergeQueries = sourceTables.map((table) => generateMergeQuery(databaseName, table.Name!, sourceBucketFromTableName(table.Name!)));

        for (const query of mergeQueries) {
            const queryResponse = await athenaClient.send(new StartQueryExecutionCommand({ QueryString: query, ResultConfiguration: { OutputLocation: `s3://${targetBucket}/athena-results/` } }));

            if (!queryResponse.QueryExecutionId) {
                throw new Error("Failed to get QueryExecutionId for merge query");
            }

            console.log("Query started with execution ID:", queryResponse.QueryExecutionId);
            await waitForQueryCompletion(queryResponse.QueryExecutionId);
            console.log("Query completed successfully");
        }

        return { message: "Merge queries started successfully", numTables: sourceTables.length };
    } catch (error) {
        const err = error as Error;
        console.error("Error merging tables:", { error: err.message, stack: err.stack, databaseName, targetBucket });
        throw err;
    }
}

async function getAllTables(databaseName: string): Promise<Table[]> {
    let allTables: Table[] = [];
    let nextToken: string | undefined = undefined;

    do {
        const tablesResponse: import("@aws-sdk/client-glue").GetTablesCommandOutput = await glueClient.send(new GetTablesCommand({ DatabaseName: databaseName, NextToken: nextToken }));
        if (!tablesResponse.TableList) {
            throw new Error(`Unable to list tables in database ${databaseName}`);
        }
        allTables.push(...tablesResponse.TableList);
        nextToken = tablesResponse.NextToken;
    } while (nextToken);

    return allTables;
}

function isSourceTable(tableName: string | undefined, tablePrefix: string | undefined): boolean {
    if (!tableName) return false;

    const isView = tableName.endsWith("-view");
    const matchesPrefix = tablePrefix ? tableName.startsWith(tablePrefix) : true;

    return isView && matchesPrefix;
}

async function ensureMergedTablesExist(databaseName: string, targetBucket: string, sourceTables: Table[]): Promise<void> {
    const packagesView = sourceTables.find((t) => t.Name?.includes("packages-view"))?.Name;
    const entriesView = sourceTables.find((t) => t.Name?.includes("objects-view"))?.Name;

    async function tableExists(tableName: string): Promise<boolean> {
        const tablesResponse = await glueClient.send(new GetTablesCommand({ DatabaseName: databaseName, Expression: tableName }));
        return (tablesResponse.TableList || []).some((t) => t.Name === tableName);
    }

    async function createTableWithCTAS(targetTable: string, sourceView: string, location: string) {
        const ctasQuery = `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${targetTable}"
            WITH (
                format = 'PARQUET',
                write_compression = 'SNAPPY',
                location = 's3://${targetBucket}/${location}/',
                table_type = 'ICEBERG',
                is_external = false,
                partitioned_by = ARRAY['source_bucket', 'timestamp']
            )
            AS SELECT * FROM "${databaseName}"."${sourceView}" WHERE false
        `;
        const response = await athenaClient.send(new StartQueryExecutionCommand({ QueryString: ctasQuery, ResultConfiguration: { OutputLocation: `s3://${targetBucket}/athena-results/` } }));
        if (!response.QueryExecutionId) {
            throw new Error(`Failed to get QueryExecutionId for CTAS for ${targetTable}`);
        }
        await waitForQueryCompletion(response.QueryExecutionId);
    }

    if (packagesView && !(await tableExists("titanic_packages"))) {
        console.log("Creating titanic_packages table using CTAS from", packagesView);
        await createTableWithCTAS("titanic_packages", packagesView, "merged/packages");
    }

    if (entriesView && !(await tableExists("titanic_entries"))) {
        console.log("Creating titanic_entries table using CTAS from", entriesView);
        await createTableWithCTAS("titanic_entries", entriesView, "merged/objects");
    }
}

function generateMergeQuery(databaseName: string, tableName: string, sourceBucket: string): string {
    const query = `
        INSERT INTO "${databaseName}"."${tableName.includes("packages-view") ? "titanic_packages" : "titanic_entries"}"
        PARTITION (source_bucket, timestamp)
        SELECT DISTINCT
            ${
                tableName.includes("packages")
                    ? `
            s.pkg_name,
            s.top_hash,
            s.timestamp,
            s.message,
            s.user_meta,
            '${sourceBucket}' AS source_bucket`
                    : `
            s.pkg_name,
            s.top_hash,
            s.timestamp,
            s.logical_key,
            s.physical_key,
            s.size,
            s.hash,
            s.meta,
            '${sourceBucket}' AS source_bucket`
            }
        FROM "${databaseName}"."${tableName}" s
        LEFT JOIN "${databaseName}"."${tableName.includes("packages-view") ? "titanic_packages" : "titanic_entries"}" t
        ON s.pkg_name = t.pkg_name 
        AND s.top_hash = t.top_hash
        AND '${sourceBucket}' = t.source_bucket
        WHERE t.pkg_name IS NULL`;

    console.log("Generated merge query for table", tableName, ":", query);
    return query;
}
