import { Context, EventBridgeEvent } from "aws-lambda";
import { AthenaUtils } from "./shared/athena-utils";
import { PackageEventDetail, HandlerResponse } from "./shared/types";
import { TableManager } from "./tables/table-manager";
import { Config } from "./shared/config";
import * as fs from "fs";

const SENTINEL_FILE = '/tmp/tables-initialized';

export async function handler(
    event: EventBridgeEvent<string, PackageEventDetail>,
    _context: Context,
): Promise<HandlerResponse> {
    console.log("Starting Titanic merge handler");
    const { bucket: sourceBucket, handle, topHash } = event.detail;
    const config = Config.create();
    const athenaUtils = new AthenaUtils(config);

    logContext(event, sourceBucket, handle, topHash, config);

    // Validate configuration
    if (
        !config.getReadDatabaseName() ||
        !config.getWriteDatabaseName() ||
        !config.getTargetBucket() ||
        !config.getResultsBucket()
    ) {
        throw new Error(
            "Missing required configuration: read/write database name, tables bucket, or results bucket"
        );
    }

    await testAthenaConnectivity(athenaUtils);

    const sourceDatabaseName = config.getReadDatabaseName();
    const targetDatabaseName = config.getWriteDatabaseName();
    const targetBucket = config.getTargetBucket();

    const tableManager = new TableManager(
        config,
        sourceDatabaseName,
        targetDatabaseName,
        targetBucket
    );

    await handleFirstRun(tableManager);

    const allTables = await athenaUtils.getAllTables(sourceDatabaseName);
    const sourceTables = filterSourceTables(allTables, sourceBucket);

    console.log("Source tables found:", sourceTables);

    return await executeMergeOperations(tableManager, sourceTables);
}

// --- Helper Functions ---

function logContext(
    event: EventBridgeEvent<string, PackageEventDetail>,
    bucket: string,
    handle: string,
    topHash: string,
    config: Config
): void {
    // Event details
    console.log("EventBridge event:", JSON.stringify(event, null, 2));
    console.log("Event details:", { bucket, handle, topHash });

    // Environment variables
    const envVars = {
        glueDatabaseName: process.env.GLUE_DATABASE_NAME,
        s3TableDatabaseName: process.env.S3TABLE_DATABASE_NAME,
        glueTablesBucketArn: process.env.GLUE_TABLES_BUCKET_ARN,
        s3TablesBucketArn: process.env.S3_TABLES_BUCKET_ARN,
    };
    console.log("Environment variables:", {
        ...envVars,
        configType: config.constructor.name,
        useS3Table: process.env.USE_S3_TABLE
    });

    // Configuration summary
    console.log("Configuration Summary:", {
        mode: config.useS3Table ? 'S3 Tables' : 'Glue Tables',
        readDatabase: config.getReadDatabaseName(),
        writeDatabase: config.getWriteDatabaseName(),
        resultsBucket: config.getResultsBucket(),
        tablesBucket: config.getTargetBucket(),
        athenaOutputLocation: `s3://${config.getResultsBucket()}/athena-results/`
    });
}

async function testAthenaConnectivity(athenaUtils: AthenaUtils): Promise<void> {
    console.log("Testing Athena connectivity before proceeding...");
    console.log("This test validates:");
    console.log("  - Athena API access (ability to start query executions)");
    console.log("  - S3 bucket write permissions for query results");
    console.log("  - Query execution context and database access");
    console.log("  - Overall end-to-end Athena + S3 integration");

    const athenaTestResult = await athenaUtils.validateAthenaAccess();

    console.log(`Athena connectivity test: ${athenaTestResult.success}`, {
        configType: athenaTestResult.configType,
        testQuery: athenaTestResult.testQuery,
        executionContext: athenaTestResult.executionContext,
        outputLocation: athenaTestResult.outputLocation,
    });
    if (athenaTestResult.error) {
        console.error(`Error details: ${athenaTestResult.error}`);
    }
}

async function handleFirstRun(tableManager: TableManager): Promise<void> {
    const isFirstRun = !fs.existsSync(SENTINEL_FILE);
    if (isFirstRun) {
        console.log('First run after deployment detected, dropping existing tables if they exist...');
        await tableManager.executeDrops();
        console.log('Existing tables dropped successfully');
        console.log('Creating tables on first run...');
        await tableManager.createTables();
        console.log('Tables created successfully');
        fs.writeFileSync(SENTINEL_FILE, new Date().toISOString());
        console.log('Created sentinel file, tables will not be dropped on subsequent runs');
    }
}

function filterSourceTables(allTables: string[], bucket: string): string[] {
    return allTables?.filter((tableName: string) => {
        console.log("Checking table:", tableName);
        if (!tableName) return false;
        const isView = tableName.endsWith("-view");
        const matchesPrefix = bucket
            ? tableName.startsWith(bucket + "_")
            : true;
        return isView && matchesPrefix;
    }) || [];
}

interface MergeOperationResult {
    message: string;
    numTables: number;
    successfulTables: number;
    failedTables: number;
    totalQueries: number;
}

async function executeMergeOperations(
    tableManager: TableManager,
    sourceTables: string[]
): Promise<MergeOperationResult> {
    console.log("Starting merge operations for", sourceTables.length, "source tables");
    
    // Separate package views from object views
    const packageView = sourceTables.find((tableName: string) => tableName && tableName.includes('packages-view'));
    const objectsView = sourceTables.find((tableName: string) => tableName && tableName.includes('objects-view'));
    
    if (!packageView && !objectsView) {
        console.log("No package or objects views found - skipping merge operations");
        return { 
            message: "No package or objects views found - skipping merge operations",
            numTables: sourceTables.length,
            successfulTables: 0, 
            failedTables: 0, 
            totalQueries: 0 
        };
    }
    
    const { successfulTables, failedTables, totalQueries } = await tableManager.executeInserts(packageView || '', objectsView || '');

    console.log(`Insert operations summary:`);
    console.log(`  - Source tables processed: ${sourceTables.length}`);
    console.log(`  - Tables with successful operations: ${successfulTables}`);
    console.log(`  - Tables with failed operations: ${failedTables}`);
    console.log(`  - Total queries executed: ${totalQueries}`);

    if (failedTables > 0) {
        console.warn(`${failedTables} tables had some failed operations. Check logs above for details.`);
    }

    return {
        message: `Merge operations completed: ${successfulTables} tables successful, ${failedTables} failed, ${totalQueries} total queries`,
        numTables: sourceTables.length,
        successfulTables,
        failedTables,
        totalQueries,
    };
}
