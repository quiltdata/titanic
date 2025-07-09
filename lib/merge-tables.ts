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
    const buckets = selectBuckets(allTables, sourceBucket);

    console.log("Buckets found:", buckets);

    return await executeMergeOperations(tableManager, buckets, allTables);
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


function selectBuckets(allTables: string[], targetBucket?: string): string[] {
    const buckets = new Set<string>();
    const skippedViews: string[] = [];

    allTables?.forEach((tableName: string) => {
        if (!tableName) {
            return; // Skip invalid table names
        }
        
        const isView = tableName.endsWith("-view");
        if (!isView) {
            return; // Ignore non-view tables entirely
        }

        // Extract bucket name from table name (assuming format: bucket_something-view)
        const bucketMatch = tableName.match(/^(.+?)_/);
        if (bucketMatch) {
            const bucketName = bucketMatch[1];
            
            // Skip processing if we already have this bucket (optimization)
            if (buckets.has(bucketName)) {
                return;
            }
            
            // If targetBucket is specified, only include matching buckets
            if (!targetBucket || bucketName === targetBucket) {
                buckets.add(bucketName);
            } else {
                skippedViews.push(tableName); // Track skipped views
            }
        } else {
            skippedViews.push(tableName); // Track views that don't match expected format
        }
    });

    const selectedBuckets = Array.from(buckets);

    // Log summary
    console.log(`Bucket selection summary: ${selectedBuckets.length} selected, ${skippedViews.length} skipped`, {
        selectedBuckets,
        skippedViews,
    });

    return selectedBuckets;
}

// Export for testing
export { selectBuckets };

export interface MergeOperationResult {
    message: string;
    numTables: number; // Now represents number of buckets processed
    successfulTables: number;
    failedTables: number;
    totalQueries: number;
}

async function executeMergeOperations(
    tableManager: TableManager,
    buckets: string[],
    allTables: string[]
): Promise<MergeOperationResult> {
    console.log("Starting merge operations for", buckets.length, "buckets");

    let totalSuccessfulTables = 0;
    let totalFailedTables = 0;
    let totalQueries = 0;

    for (const bucket of buckets) {
        console.log(`Processing bucket: ${bucket}`);

        // Reconstruct packageView and objectView for this bucket
        const packageView = allTables.find((tableName: string) => 
            tableName && tableName === `${bucket}_packages-view`
        );
        const objectsView = allTables.find((tableName: string) => 
            tableName && tableName === `${bucket}_objects-view`
        );

        if (!packageView && !objectsView) {
            console.log(`No package or objects views found for bucket ${bucket} - skipping`);
            continue;
        }

        console.log(`Found views for bucket ${bucket}:`, {
            packageView: packageView || 'none',
            objectsView: objectsView || 'none'
        });

        try {
            const { successfulTables, failedTables, totalQueries: bucketQueries } = 
                await tableManager.executeInserts(packageView || '', objectsView || '');

            totalSuccessfulTables += successfulTables;
            totalFailedTables += failedTables;
            totalQueries += bucketQueries;

            console.log(`Bucket ${bucket} operations summary:`);
            console.log(`  - Successful operations: ${successfulTables}`);
            console.log(`  - Failed operations: ${failedTables}`);
            console.log(`  - Queries executed: ${bucketQueries}`);

        } catch (error) {
            console.error(`Error processing bucket ${bucket}:`, error);
            totalFailedTables++;
        }
    }

    console.log(`All merge operations summary:`);
    console.log(`  - Buckets processed: ${buckets.length}`);
    console.log(`  - Tables with successful operations: ${totalSuccessfulTables}`);
    console.log(`  - Tables with failed operations: ${totalFailedTables}`);
    console.log(`  - Total queries executed: ${totalQueries}`);

    if (totalFailedTables > 0) {
        console.warn(`${totalFailedTables} tables had some failed operations. Check logs above for details.`);
    }

    return {
        message: `Merge operations completed: ${totalSuccessfulTables} tables successful, ${totalFailedTables} failed, ${totalQueries} total queries`,
        numTables: buckets.length,
        successfulTables: totalSuccessfulTables,
        failedTables: totalFailedTables,
        totalQueries,
    };
}

// Export for testing
export { executeMergeOperations };
