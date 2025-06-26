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
    const useS3Table = process.env.USE_S3_TABLE === "true";
    console.log("Environment variables:", {
        databaseName,
        targetBucket,
        useS3Table,
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
            
            // Match bucket name - table names use format: bucket_tabletype-view
            // The bucket name in the table keeps its original format (with hyphens)
            const matchesPrefix = bucket
                ? table.Name.startsWith(bucket + "_")
                : true;

            return isView && matchesPrefix;
        }) || [];

        console.log("Source tables found:", sourceTables.map((t) => t.Name));

        // Initialize table manager
        const tableManager = new TableManager(databaseName, targetBucket, useS3Table);

        // Ensure all required tables exist
        try {
            await tableManager.ensureTablesExist(sourceTables);
        } catch (error) {
            const err = error as Error;
            console.error("Error ensuring tables exist:", {
                error: err.message,
                stack: err.stack,
            });
            // Continue with insert operations even if some table creation failed
        }

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
            message: `Merge operations completed: ${queryCount} successful queries`,
            numTables: sourceTables.length,
        };
    } catch (error) {
        const err = error as Error;
        const isS3AccessError = err.message.toLowerCase().includes('access denied') ||
                               err.message.toLowerCase().includes('accessdenied') ||
                               err.message.toLowerCase().includes('no such bucket') ||
                               err.message.toLowerCase().includes('forbidden') ||
                               err.message.toLowerCase().includes('403');

        console.error("Error merging tables:", {
            error: err.message,
            stack: err.stack,
            databaseName,
            targetBucket,
            isS3AccessError,
            eventDetails: event.detail,
        });

        if (isS3AccessError) {
            console.error("S3 access error detected. This may be due to insufficient permissions or missing buckets.");
            console.error("Consider checking:");
            console.error("1. Lambda execution role permissions for S3 buckets");
            console.error("2. Bucket existence and access policies");
            console.error("3. Cross-account access configurations");
        }

        throw err;
    }
}