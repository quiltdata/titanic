import { Context, EventBridgeEvent } from "aws-lambda";
import { AthenaTest } from "./shared/athena-test";
import { handler, selectBuckets, executeMergeOperations } from "./merge-tables";
import { PackageEventDetail } from "./shared/types";
import { Config } from "./shared/config";
import { TableManager } from "./tables/table-manager";

// Helper to create EventBridge event
const createEventBridgeEvent = (bucket: string = "test-bucket"): EventBridgeEvent<string, PackageEventDetail> => ({
    version: "0",
    id: "test-event-id",
    "detail-type": "package-revision", 
    source: "com.quiltdata",
    account: "012345678901",
    time: "2025-04-25T14:46:51Z",
    region: "us-east-2",
    resources: [],
    detail: {
        version: "0.1",
        type: "created",
        bucket,
        handle: "test/2024-01-18",
        topHash: "39cb81fc1a02d5487d982d9adfbfabf328e4fa07161813497f5571c35674def2"
    }
});

describe("merge-tables lambda", () => {
    let athenaTest: AthenaTest;
    let testConfig: Config;

    beforeEach(() => {
        process.env.NODE_ENV = "test";
        process.env.GLUE_DATABASE_NAME = "test-db";
        process.env.S3TABLE_DATABASE_NAME = "test-db";
        process.env.GLUE_TABLES_BUCKET_ARN = "arn:aws:s3:::test-bucket";
        process.env.S3_TABLES_BUCKET_ARN = "arn:aws:s3tables:us-east-1:123456789012:bucket/test-tables-bucket";
        process.env.ATHENA_RESULTS_BUCKET_ARN = "arn:aws:s3:::test-bucket";
        process.env.LAMBDA_TIMEOUT = "5000";
        delete process.env.USE_S3_TABLE; // Default to Glue mode

        // Setup test config and AthenaTest
        testConfig = Config.createTestInstance({
            glueDatabaseName: "test-db",
            glueTablesBucketArn: "arn:aws:s3:::test-bucket"
        });
        athenaTest = AthenaTest.createTestInstance(testConfig);
    });

    describe("Mode-specific behavior", () => {
        it("should return skip message if environment variables are missing", async () => {
            delete process.env.GLUE_DATABASE_NAME;
            delete process.env.S3TABLE_DATABASE_NAME;
            
            athenaTest.mockTablesInDatabase([]);
            
            const mockEvent = createEventBridgeEvent();
            const result = await handler(mockEvent, {} as Context);
            expect(result).toEqual({
                failedTables: 0,
                message: "Merge operations completed: 0 tables successful, 0 failed, 0 total queries",
                numTables: 0,
                successfulTables: 0,
                totalQueries: 0,
            });
        });
    });

    it("should respect custom timeout configuration", async () => {
        process.env.LAMBDA_TIMEOUT = "10000";

        athenaTest.mockTablesInDatabase([]);
        athenaTest.mockQueryResult(true);

        const mockEvent = createEventBridgeEvent();
        const result = await handler(mockEvent, {} as Context);
        expect(result).toBeDefined();
    });

    describe("error handling scenarios", () => {
        it("should handle errors during table ensure operations", async () => {
            athenaTest.mockTablesInDatabase([{ Name: "test-bucket_packages-view" }]);
            athenaTest.mockQueryResult(false); // Mock query failure that returns false

            const event = createEventBridgeEvent();
            const context: Context = {} as any;

            const result = await handler(event, context);
            expect(result).toBeDefined();
            expect(result!.numTables).toBe(1);
            expect(result!.message).toContain("failed");
        });

        it("should handle successful query execution", async () => {
            athenaTest.mockTablesInDatabase([{ Name: "test-bucket_packages-view" }]);
            athenaTest.mockQueryResult(true); // Mock successful query execution

            const event = createEventBridgeEvent();
            const context: Context = {} as any;

            const result = await handler(event, context);
            expect(result).toBeDefined();
            expect(result!.numTables).toBe(1);
        });

        it("should handle connectivity test failures gracefully", async () => {
            athenaTest.mockTablesInDatabase([]);
            athenaTest.mockQueryResult(false); // Mock connectivity test failure

            const event = createEventBridgeEvent();
            const context: Context = {} as any;

            // Should still complete successfully even if connectivity test fails
            const result = await handler(event, context);
            expect(result).toBeDefined();
            expect(result!.message).toContain("Merge operations completed");
        });
    });
});

describe("selectBuckets unit tests", () => {
    // Mock console.log to avoid cluttering test output
    const originalConsoleLog = console.log;
    beforeEach(() => {
        console.log = jest.fn();
    });
    
    afterEach(() => {
        console.log = originalConsoleLog;
    });

    describe("basic functionality", () => {
        it("should return empty array when no tables provided", () => {
            const result = selectBuckets([]);
            expect(result).toEqual([]);
        });

        it("should return empty array when tables are null/undefined", () => {
            expect(selectBuckets(null as any)).toEqual([]);
            expect(selectBuckets(undefined as any)).toEqual([]);
        });

        it("should ignore non-view tables", () => {
            const tables = [
                "regular-table",
                "another-table",
                "bucket1_packages-view",
                "some-other-table"
            ];
            const result = selectBuckets(tables);
            expect(result).toEqual(["bucket1"]);
        });

        it("should ignore empty or invalid table names", () => {
            const tables = [
                "",
                "bucket1_packages-view",
                "bucket2_objects-view"
            ];
            const result = selectBuckets(tables);
            expect(result).toEqual(["bucket1", "bucket2"]);
        });
    });

    describe("bucket extraction", () => {
        it("should extract bucket names from valid view table names", () => {
            const tables = [
                "bucket1_packages-view",
                "bucket2_objects-view",
            ];
            const result = selectBuckets(tables);
            expect(result).toEqual(["bucket1", "bucket2"]);
        });

        it("should handle views that don't match expected format", () => {
            const tables = [
                "bucket1_packages-view",
                "invalid-view-format",
                "bucket3_something-view",
                "bucket2_objects-view"
            ];
            const result = selectBuckets(tables);
            expect(result).toEqual(["bucket1", "bucket2"]);
        });

        it("should deduplicate bucket names", () => {
            const tables = [
                "bucket1_packages-view",
                "bucket1_objects-view",
                "bucket2_packages-view",
                "bucket2_objects-view"
            ];
            const result = selectBuckets(tables);
            expect(result).toEqual(["bucket1", "bucket2"]);
        });
    });

    describe("target bucket filtering", () => {
        const testTables = [
            "bucket1_packages-view",
            "bucket2_objects-view",
            "bucket3_objects-view",
            "bucket4_packages-view"
        ];

        it("should return all buckets when no targetBucket specified", () => {
            const result = selectBuckets(testTables);
            expect(result).toEqual(["bucket1", "bucket2", "bucket3", "bucket4"]);
        });

        it("should return only matching bucket when targetBucket specified", () => {
            const result = selectBuckets(testTables, "bucket2");
            expect(result).toEqual(["bucket2"]);
        });

        it("should return empty array when targetBucket doesn't match any tables", () => {
            const result = selectBuckets(testTables, "nonexistent-bucket");
            expect(result).toEqual([]);
        });

        it("should handle multiple views from same target bucket", () => {
            const tables = [
                "target_packages-view",
                "target_objects-view",
                "other_packages-view"
            ];
            const result = selectBuckets(tables, "target");
            expect(result).toEqual(["target"]);
        });
    });
});

describe("executeMergeOperations unit tests", () => {
    let mockTableManager: jest.Mocked<TableManager>;
    
    // Mock console methods to avoid cluttering test output
    const originalConsole = { log: console.log, warn: console.warn, error: console.error };
    beforeEach(() => {
        console.log = jest.fn();
        console.warn = jest.fn();
        console.error = jest.fn();
        
        // Create a mock TableManager
        mockTableManager = {
            executeInserts: jest.fn()
        } as any;
    });
    
    afterEach(() => {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
    });

    describe("basic functionality", () => {
        it("should return empty result when no buckets provided", async () => {
            const result = await executeMergeOperations(mockTableManager, [], []);
            
            expect(result).toEqual({
                message: "Merge operations completed: 0 tables successful, 0 failed, 0 total queries",
                numTables: 0,
                successfulTables: 0,
                failedTables: 0,
                totalQueries: 0
            });
            expect(mockTableManager.executeInserts).not.toHaveBeenCalled();
        });

        it("should skip buckets with no matching views", async () => {
            const buckets = ["bucket1", "bucket2"];
            const allTables = ["bucket3_packages-view", "bucket4_objects-view"];
            
            const result = await executeMergeOperations(mockTableManager, buckets, allTables);
            
            expect(result.numTables).toBe(2);
            expect(result.successfulTables).toBe(0);
            expect(result.failedTables).toBe(0);
            expect(mockTableManager.executeInserts).not.toHaveBeenCalled();
        });
    });

    describe("successful operations", () => {
        it("should process bucket with package view only", async () => {
            mockTableManager.executeInserts.mockResolvedValue({
                successfulTables: 1,
                failedTables: 0,
                totalQueries: 2
            });
            
            const buckets = ["bucket1"];
            const allTables = ["bucket1_packages-view"];
            
            const result = await executeMergeOperations(mockTableManager, buckets, allTables);
            
            expect(result).toEqual({
                message: "Merge operations completed: 1 tables successful, 0 failed, 2 total queries",
                numTables: 1,
                successfulTables: 1,
                failedTables: 0,
                totalQueries: 2
            });
            expect(mockTableManager.executeInserts).toHaveBeenCalledWith("bucket1_packages-view", "");
        });

        it("should process bucket with objects view only", async () => {
            mockTableManager.executeInserts.mockResolvedValue({
                successfulTables: 1,
                failedTables: 0,
                totalQueries: 3
            });
            
            const buckets = ["bucket1"];
            const allTables = ["bucket1_objects-view"];
            
            const result = await executeMergeOperations(mockTableManager, buckets, allTables);
            
            expect(result).toEqual({
                message: "Merge operations completed: 1 tables successful, 0 failed, 3 total queries",
                numTables: 1,
                successfulTables: 1,
                failedTables: 0,
                totalQueries: 3
            });
            expect(mockTableManager.executeInserts).toHaveBeenCalledWith("", "bucket1_objects-view");
        });

        it("should process bucket with both package and objects views", async () => {
            mockTableManager.executeInserts.mockResolvedValue({
                successfulTables: 2,
                failedTables: 0,
                totalQueries: 4
            });
            
            const buckets = ["bucket1"];
            const allTables = ["bucket1_packages-view", "bucket1_objects-view"];
            
            const result = await executeMergeOperations(mockTableManager, buckets, allTables);
            
            expect(result).toEqual({
                message: "Merge operations completed: 2 tables successful, 0 failed, 4 total queries",
                numTables: 1,
                successfulTables: 2,
                failedTables: 0,
                totalQueries: 4
            });
            expect(mockTableManager.executeInserts).toHaveBeenCalledWith("bucket1_packages-view", "bucket1_objects-view");
        });

        it("should aggregate results from multiple buckets", async () => {
            mockTableManager.executeInserts
                .mockResolvedValueOnce({ successfulTables: 1, failedTables: 0, totalQueries: 2 })
                .mockResolvedValueOnce({ successfulTables: 2, failedTables: 1, totalQueries: 3 });
            
            const buckets = ["bucket1", "bucket2"];
            const allTables = [
                "bucket1_packages-view",
                "bucket2_packages-view",
                "bucket2_objects-view"
            ];
            
            const result = await executeMergeOperations(mockTableManager, buckets, allTables);
            
            expect(result).toEqual({
                message: "Merge operations completed: 3 tables successful, 1 failed, 5 total queries",
                numTables: 2,
                successfulTables: 3,
                failedTables: 1,
                totalQueries: 5
            });
            expect(mockTableManager.executeInserts).toHaveBeenCalledTimes(2);
        });
    });

    describe("error handling", () => {
        it("should handle executeInserts throwing an error", async () => {
            mockTableManager.executeInserts.mockRejectedValue(new Error("Database error"));
            
            const buckets = ["bucket1"];
            const allTables = ["bucket1_packages-view"];
            
            const result = await executeMergeOperations(mockTableManager, buckets, allTables);
            
            expect(result).toEqual({
                message: "Merge operations completed: 0 tables successful, 1 failed, 0 total queries",
                numTables: 1,
                successfulTables: 0,
                failedTables: 1,
                totalQueries: 0
            });
        });

        it("should continue processing other buckets when one fails", async () => {
            mockTableManager.executeInserts
                .mockRejectedValueOnce(new Error("Database error"))
                .mockResolvedValueOnce({ successfulTables: 1, failedTables: 0, totalQueries: 2 });
            
            const buckets = ["bucket1", "bucket2"];
            const allTables = ["bucket1_packages-view", "bucket2_packages-view"];
            
            const result = await executeMergeOperations(mockTableManager, buckets, allTables);
            
            expect(result).toEqual({
                message: "Merge operations completed: 1 tables successful, 1 failed, 2 total queries",
                numTables: 2,
                successfulTables: 1,
                failedTables: 1,
                totalQueries: 2
            });
        });
    });
});
