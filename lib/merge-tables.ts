import { Context, EventBridgeEvent } from "aws-lambda";
import { GetTablesCommand, GetTablesCommandOutput } from "@aws-sdk/client-glue";
import { glueClient, dropAllTitanicTables } from "./shared/athena-utils";
import { PackageEventDetail, HandlerResponse } from "./shared/types";
import { TableManager } from "./tables/table-manager";
import * as fs from "fs";

const SENTINEL_FILE = '/tmp/tables-initialized';

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
        // Check if this is first run after deployment
        const isFirstRun = !fs.existsSync(SENTINEL_FILE);
        
        if (isFirstRun) {
            console.log('First run after deployment detected, dropping existing tables...');
            await dropAllTitanicTables(databaseName, targetBucket);
            
            // Create sentinel file to mark tables as initialized
            fs.writeFileSync(SENTINEL_FILE, new Date().toISOString());
            console.log('Created sentinel file, tables will not be dropped on subsequent runs');
        }

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
            const { successfulTables, failedTables, totalTables } = await tableManager.ensureTablesExist(sourceTables);
            console.log(`Ensured tables exist: ${successfulTables} successful, ${failedTables} failed out of ${totalTables}`);
        } catch (error) {
            const err = error as Error;
            console.error("Unexpected error while ensuring tables exist:", {
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
        const { successfulTables, failedTables, totalQueries } = await tableManager.executeInserts(sourceTables);
        
        console.log(`Insert operations summary:`);
        console.log(`  - Source tables processed: ${sourceTables.length}`);
        console.log(`  - Tables with successful operations: ${successfulTables}`);
        console.log(`  - Tables with failed operations: ${failedTables}`);
        console.log(`  - Total queries executed: ${totalQueries}`);
        
        if (failedTables > 0) {
            console.warn(`⚠️ ${failedTables} tables had some failed operations. Check logs above for details.`);
        }

        return {
            message: `Merge operations completed: ${successfulTables} tables successful, ${failedTables} failed, ${totalQueries} total queries`,
            numTables: sourceTables.length,
            successfulTables,
            failedTables,
            totalQueries,
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