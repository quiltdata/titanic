import { Context, EventBridgeEvent } from "aws-lambda";
import { AthenaUtils } from "./shared/athena-utils";
import { PackageEventDetail, HandlerResponse } from "./shared/types";
import { TableManager } from "./tables/table-manager";
import { Config } from "./shared/config";
// Removed fs and sentinel file logic

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

    const results = await tableManager.ensureExists();
    console.log("TableManager ensureExists results:", results);

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
    const envSummary = {
        glueDatabaseName: process.env.GLUE_DATABASE_NAME,
        s3TableDatabaseName: process.env.S3TABLE_DATABASE_NAME,
        glueTablesBucketArn: process.env.GLUE_TABLES_BUCKET_ARN,
        s3TablesBucketArn: process.env.S3_TABLES_BUCKET_ARN,
        configType: config.constructor.name,
        useS3Table: process.env.USE_S3_TABLE
    };

    const configSummary = {
        mode: config.useS3Table ? 'S3 Tables' : 'Glue Tables',
        readDatabase: config.getReadDatabaseName(),
        writeDatabase: config.getWriteDatabaseName(),
        resultsBucket: config.getResultsBucket(),
        tablesBucket: config.getTargetBucket(),
        athenaOutputLocation: `s3://${config.getResultsBucket()}/athena-results/`
    };

    console.log("Execution Context:", {
        env: envSummary,
        eventDetails: { bucket, handle, topHash },
        config: configSummary,
        event: event
    });
}

async function testAthenaConnectivity(athenaUtils: AthenaUtils): Promise<void> {
    console.log("Testing Athena+S3 connectivity before proceeding...", {
        checks: [
            "Athena API access (ability to start query executions)",
            "S3 bucket write permissions for query results",
            "Query execution context and database access",
            "Overall end-to-end Athena + S3 integration"
        ]
    });

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


function filterSourceTables(allTables: string[], bucket: string): string[] {
    const selectedTables: string[] = [];
    const ignoredTables: string[] = [];

    allTables?.forEach((tableName: string) => {
        if (!tableName) {
            return; // Skip invalid table names
        }
        
        const isView = tableName.endsWith("-view");
        const matchesPrefix = bucket
            ? tableName.startsWith(bucket + "_")
            : true;
        
        if (isView && matchesPrefix) {
            selectedTables.push(tableName);
        } else {
            ignoredTables.push(tableName);
        }
    });

    // Log summary
    console.log("Table filtering summary:", {
        selected: selectedTables.length,
        ignored: ignoredTables.length,
        selectedTables: selectedTables,
        ignoredTables: ignoredTables.length > 0 ? ignoredTables : undefined
    });

    return selectedTables;
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
