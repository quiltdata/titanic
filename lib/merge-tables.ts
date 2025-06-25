import { Context, EventBridgeEvent } from "aws-lambda";
import { GetTablesCommand, GetTablesCommandOutput } from "@aws-sdk/client-glue";
import { glueClient } from "./shared/athena-utils";
import { PackageEventDetail, HandlerResponse } from "./shared/types";
import { TableManager } from "./tables/table-manager";

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

        // Filter for source tables (excluding the merged table)
        const sourceTables = allTables?.filter((table) => {
            console.log("Checking table:", table.Name);
            if (!table.Name) return false;

            // Check if table name ends with -view
            const isView = table.Name.endsWith("-view");
            const matchesPrefix = bucket
                ? table.Name.startsWith(bucket)
                : true;

            return isView && matchesPrefix;
        }) || [];

        console.log("Source tables found:", sourceTables.map((t) => t.Name));

        // Initialize table manager
        const tableManager = new TableManager(databaseName, targetBucket);

        // Ensure all required tables exist
        await tableManager.ensureTablesExist(sourceTables);

        // Check for empty source tables
        if (sourceTables.length === 0) {
            return {
                message: "Created tables (no source tables found)",
                numTables: 0,
            };
        }

        // Execute merge operations
        console.log("Starting merge operations for", sourceTables.length, "source tables");
        const queryCount = await tableManager.executeInserts(sourceTables);
        console.log(`Executed ${queryCount} queries successfully`);

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