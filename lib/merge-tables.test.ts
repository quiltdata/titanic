import { Context, EventBridgeEvent } from "aws-lambda";
import { AthenaTest } from "./shared/athena-test";
import { handler } from "./merge-tables";
import { PackageEventDetail } from "./shared/types";
import { Config } from "./shared/config";

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
                message: "No package or objects views found - skipping merge operations",
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
            expect(result!.message).toContain("No package or objects views found");
        });
    });
});
