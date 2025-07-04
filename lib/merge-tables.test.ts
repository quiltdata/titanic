import { Context, EventBridgeEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";

jest.setTimeout(30000); // Increase timeout to 30 seconds

// Mock fs before any AWS SDK imports with a more complete implementation
const originalFs = jest.requireActual('fs');
jest.mock("fs", () => ({
    ...originalFs,
    existsSync: jest.fn(),
    writeFileSync: jest.fn(),
    promises: {
        ...originalFs.promises,
        readFile: jest.fn().mockResolvedValue(''),
        writeFile: jest.fn().mockResolvedValue(undefined),
        stat: jest.fn().mockResolvedValue({ isFile: () => true }),
        readdir: jest.fn().mockResolvedValue([]),
        access: jest.fn().mockResolvedValue(undefined),
    },
}));

import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { handler } from "./merge-tables";
import { PackageEventDetail } from "./shared/types";
import * as fs from "fs";

const mockFs = fs as jest.Mocked<typeof fs>;

const glueMock = mockClient(GlueClient);
const athenaMock = mockClient(AthenaClient);

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
    beforeEach(() => {
        process.env.NODE_ENV = "test";
        process.env.GLUE_DATABASE_NAME = "test-db";
        process.env.S3TABLE_DATABASE_NAME = "test-db";
        process.env.GLUE_TABLES_BUCKET_ARN = "arn:aws:s3:::test-bucket";
        process.env.S3_TABLES_BUCKET_ARN = "arn:aws:s3tables:us-east-1:123456789012:bucket/test-tables-bucket";
        process.env.ATHENA_RESULTS_BUCKET_ARN = "arn:aws:s3:::test-bucket";
        process.env.LAMBDA_TIMEOUT = "5000";
        delete process.env.USE_S3_TABLE; // Default to Glue mode
        glueMock.reset();
        athenaMock.reset();
        
        // Reset fs mocks
        mockFs.existsSync.mockReturnValue(true); // Default: not first run
        mockFs.writeFileSync.mockImplementation(() => {});
    });

    describe("Mode-specific behavior", () => {
        it("should return skip message if environment variables are missing", async () => {
            delete process.env.GLUE_DATABASE_NAME;
            delete process.env.S3TABLE_DATABASE_NAME;
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

        glueMock.on(GetTablesCommand).resolves({
            TableList: [],
            NextToken: undefined,
        });

        athenaMock.on(StartQueryExecutionCommand).resolves({
            QueryExecutionId: "test-query-id",
        });

        athenaMock.on(GetQueryExecutionCommand).resolves({
            QueryExecution: {
                Status: {
                    State: QueryExecutionState.SUCCEEDED,
                },
            },
        });

        const mockEvent = createEventBridgeEvent();
        const result = await handler(mockEvent, {} as Context);
        expect(result).toBeDefined();
    });

    describe("first run sentinel file handling", () => {
        it("should handle first run when sentinel file doesn't exist", async () => {
            // Mock sentinel file doesn't exist
            mockFs.existsSync.mockReturnValue(false);

            // Set up mocks for successful operation
            glueMock.on(GetTablesCommand).resolves({ TableList: [] });
            athenaMock.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: "test-id" });
            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: { Status: { State: QueryExecutionState.SUCCEEDED } }
            });

            const event = createEventBridgeEvent();
            const context: Context = {} as any;

            await handler(event, context);

            expect(mockFs.existsSync).toHaveBeenCalled();
            expect(mockFs.writeFileSync).toHaveBeenCalled();
        });
    });

    describe("error handling scenarios", () => {
        it("should handle errors during table ensure operations", async () => {
            // Mock sentinel file exists (not first run)
            mockFs.existsSync.mockReturnValue(true);
            
            // Mock table existence but make the process encounter an error during table operations
            glueMock.on(GetTablesCommand).resolves({ 
                TableList: [{ Name: "test-bucket_packages-view" }] 
            });
            
            // Mock the query execution to fail, which should cause the lambda to eventually throw
            athenaMock.on(StartQueryExecutionCommand).rejects(new Error("Ensure tables failed"));

            const event = createEventBridgeEvent();
            const context: Context = {} as any;

            // The handler should still complete but the ensure tables operation should fail gracefully
            const result = await handler(event, context);
            expect(result).toBeDefined();
            expect(result!.numTables).toBe(1); // It should process the table but encounter errors
            expect(result!.message).toContain("failed"); // Should contain "failed" in the message
        });

        it("should detect and handle S3 access errors", async () => {
            const event = createEventBridgeEvent();
            const context: Context = {} as any;
            
            // Mock an S3 access error
            glueMock.on(GetTablesCommand).rejects(new Error("Access denied to S3 bucket"));

            await expect(handler(event, context)).rejects.toThrow("Access denied to S3 bucket");
        });

        it("should detect and handle S3 AccessDenied errors", async () => {
            const event = createEventBridgeEvent();
            const context: Context = {} as any;
            
            glueMock.on(GetTablesCommand).rejects(new Error("AccessDenied: User is not authorized"));

            await expect(handler(event, context)).rejects.toThrow("AccessDenied: User is not authorized");
        });

        it("should detect and handle S3 no such bucket errors", async () => {
            const event = createEventBridgeEvent();
            const context: Context = {} as any;
            
            glueMock.on(GetTablesCommand).rejects(new Error("No such bucket: test-bucket"));

            await expect(handler(event, context)).rejects.toThrow("No such bucket: test-bucket");
        });

        it("should detect and handle S3 forbidden errors", async () => {
            const event = createEventBridgeEvent();
            const context: Context = {} as any;
            
            glueMock.on(GetTablesCommand).rejects(new Error("Forbidden: Access to bucket denied"));

            await expect(handler(event, context)).rejects.toThrow("Forbidden: Access to bucket denied");
        });

        it("should detect and handle HTTP 403 errors", async () => {
            const event = createEventBridgeEvent();
            const context: Context = {} as any;
            
            glueMock.on(GetTablesCommand).rejects(new Error("HTTP 403 error occurred"));

            await expect(handler(event, context)).rejects.toThrow("HTTP 403 error occurred");
        });
    });
});
