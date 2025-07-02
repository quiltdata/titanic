import { Context, EventBridgeEvent } from "aws-lambda";
import { AthenaUtils } from "./shared/athena-utils";
import { PackageEventDetail, HandlerResponse } from "./shared/types";
import { TableManager } from "./tables/table-manager";
import { Config } from "./shared/config";
import * as fs from "fs";

const SENTINEL_FILE = '/tmp/tables-initialized';

export async function handler(
    event: EventBridgeEvent<string, PackageEventDetail>,
    context: Context,
): Promise<HandlerResponse> {
    const config = Config.create(); // Use factory method instead of getInstance
    const athenaUtils = new AthenaUtils(config);
    const glueDatabaseName = process.env.GLUE_DATABASE_NAME;
    const s3TableDatabaseName = process.env.S3TABLE_DATABASE_NAME;
    const glueTablesBucket = process.env.GLUE_TABLES_BUCKET;
    const s3TablesBucket = process.env.S3_TABLES_BUCKET;
    
    console.log("Environment variables:", {
        glueDatabaseName,
        s3TableDatabaseName,
        glueTablesBucket,
        s3TablesBucket,
        configType: config.constructor.name,
    });

    if (!glueDatabaseName || !s3TableDatabaseName || !glueTablesBucket || !s3TablesBucket) {
        throw new Error(
            "Missing required environment variables: GLUE_DATABASE_NAME, S3TABLE_DATABASE_NAME, GLUE_TABLES_BUCKET, or S3_TABLES_BUCKET",
        );
    }

    // Choose target database and bucket based on config type
    const targetDatabaseName = config.getWriteDatabaseName();
    const targetBucket = config.getTablesBucket();

    try {
        // Check if this is first run after deployment and set in config
        const isFirstRun = !fs.existsSync(SENTINEL_FILE);
        if (isFirstRun) {
            console.log('First run after deployment detected, dropping existing tables...');
            await athenaUtils.dropAllTitanicTables();
            // Create sentinel file to mark tables as initialized
            fs.writeFileSync(SENTINEL_FILE, new Date().toISOString());
            console.log('Created sentinel file, tables will not be dropped on subsequent runs');
        }

        // Extract details from EventBridge event
        console.log("EventBridge event:", JSON.stringify(event, null, 2));
        const { bucket, handle, topHash } = event.detail;
        console.log("Event details:", { bucket, handle, topHash });

        // Get all tables in the database
        console.log("Fetching tables from Glue database:", glueDatabaseName);
        const allTables = await athenaUtils.getAllTables(glueDatabaseName);

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
        const tableManager = new TableManager(config, glueDatabaseName, targetDatabaseName, targetBucket);

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
            glueDatabaseName,
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
