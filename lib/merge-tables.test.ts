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
        it("should throw error if environment variables are missing", async () => {
            delete process.env.GLUE_DATABASE_NAME;
            delete process.env.S3TABLE_DATABASE_NAME;
            const mockEvent = createEventBridgeEvent();
            await expect(handler(mockEvent, {} as Context)).rejects.toThrow(
                "Missing required environment variables: GLUE_DATABASE_NAME, S3TABLE_DATABASE_NAME, GLUE_TABLES_BUCKET_ARN, or S3_TABLES_BUCKET_ARN",
            );
        });

        it("should configure S3 Tables mode when USE_S3_TABLE=true", async () => {
            process.env.USE_S3_TABLE = "true";
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    { Name: "test-bucket_packages-view" },
                    { Name: "test-bucket_objects-view" },
                ],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            const result = await handler(mockEvent, {} as Context);

            expect(result?.message).toContain("Merge operations completed");
            expect(result?.message).toContain("2 tables successful, 0 failed, 3 total queries");
        });

        it("should configure Glue mode when USE_S3_TABLE=false", async () => {
            process.env.USE_S3_TABLE = "false";
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    { Name: "test-bucket_packages-view" },
                    { Name: "test-bucket_objects-view" },
                ],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            const result = await handler(mockEvent, {} as Context);

            expect(result?.message).toContain("Merge operations completed");
            expect(result?.message).toContain("2 tables successful, 0 failed, 3 total queries");
        });

        it("should default to Glue mode when USE_S3_TABLE is undefined", async () => {
            delete process.env.USE_S3_TABLE;
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    { Name: "test-bucket_packages-view" },
                    { Name: "test-bucket_objects-view" },
                ],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            const result = await handler(mockEvent, {} as Context);

            expect(result?.message).toContain("Merge operations completed");
            expect(result?.message).toContain("2 tables successful, 0 failed, 3 total queries");
        });
    });

    it("should handle empty table list gracefully", async () => {
        glueMock.on(GetTablesCommand).resolves({
            TableList: [],
            NextToken: undefined,
        });

        // Mock successful table cleanup and creation
        athenaMock
            .on(StartQueryExecutionCommand)
            .resolvesOnce({ QueryExecutionId: "cleanup-packages-id" })
            .resolvesOnce({ QueryExecutionId: "cleanup-objects-id" })
            .resolvesOnce({ QueryExecutionId: "create-packages-id" })
            .resolvesOnce({ QueryExecutionId: "create-objects-id" });

        athenaMock
            .on(GetQueryExecutionCommand)
            .resolvesOnce({ // cleanup packages
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            })
            .resolvesOnce({ // cleanup objects
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            })
            .resolvesOnce({ // create packages
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            })
            .resolvesOnce({ // create objects
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

        const mockEvent = createEventBridgeEvent();
        const result = await handler(mockEvent, {} as Context);
        expect(result).toEqual({
            message: "Created tables (no source tables found)",
            numTables: 0,
        });
    });

    it("should successfully merge S3-backed tables", async () => {
        glueMock.on(GetTablesCommand).resolves({
            TableList: [
                {
                    Name: "test-bucket_objects-view",
                    StorageDescriptor: { Location: "s3://test-bucket/objects" },
                },
                {
                    Name: "test-bucket_packages-view",
                    StorageDescriptor: { Location: "s3://test-bucket/packages" },
                },
            ],
            NextToken: undefined,
        });

        athenaMock.on(StartQueryExecutionCommand).resolves({
            QueryExecutionId: "test-execution-id",
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

        expect(result).toEqual({
            message: "Merge operations completed: 2 tables successful, 0 failed, 3 total queries",
            numTables: 2, // Should find test-bucket_objects-view and test-bucket_packages-view
            successfulTables: 2,
            failedTables: 0,
            totalQueries: 3,
        });
    });

    describe("bucket-based filtering", () => {
        it("should handle EventBridge events with bucket filtering", async () => {
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    {
                        Name: "test-bucket_objects-view",
                        StorageDescriptor: { Location: "s3://test/objects" },
                    },
                    {
                        Name: "prod-bucket_objects-view",
                        StorageDescriptor: { Location: "s3://prod/objects" },
                    },
                    {
                        Name: "dev-bucket_objects-view",
                        StorageDescriptor: {
                            Location: "s3://bucket/objects_all",
                        },
                    },
                ],
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

            const eventBridgeEvent = createEventBridgeEvent("test-bucket");

            const result = await handler(eventBridgeEvent, {} as Context);
            expect(result).toEqual({
                message: "Merge operations completed: 1 tables successful, 0 failed, 1 total queries",
                numTables: 1, // Should find test-bucket_objects-view
                successfulTables: 1,
                failedTables: 0,
                totalQueries: 1,
            });
        });

        it("should handle invalid bucket gracefully", async () => {
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    {
                        Name: "packages_all_prod",
                        StorageDescriptor: {
                            Location: "s3://bucket/packages_all",
                        },
                    },
                ],
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

            const eventBridgeEvent = createEventBridgeEvent("nonexistent-bucket");

            const result = await handler(eventBridgeEvent, {} as Context);
            expect(result).toEqual({
                message: "Created tables (no source tables found)",
                numTables: 0,
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

    it("should handle Athena query failures gracefully", async () => {
        // Mock tables response with a view table to ensure merge is attempted
        glueMock.on(GetTablesCommand).resolves({
            TableList: [
                {
                    Name: "test-bucket_objects-view",
                    StorageDescriptor: { Location: "s3://test-bucket/table1" },
                },
            ],
            NextToken: undefined,
        });

        // Mock Athena failure response
        athenaMock.on(StartQueryExecutionCommand).resolves({
            QueryExecutionId: "test-execution-id",
        });

        athenaMock.on(GetQueryExecutionCommand).resolves({
            QueryExecution: {
                Status: {
                    State: QueryExecutionState.FAILED,
                    StateChangeReason: "Athena error",
                },
            },
        });

        athenaMock.on(GetQueryExecutionCommand).resolves({
            QueryExecution: {
                Status: {
                    State: QueryExecutionState.FAILED,
                    StateChangeReason: "Athena error",
                },
            },
        });

        // Test that the Athena error is handled gracefully and processing continues
        const mockEvent = createEventBridgeEvent();
        const result = await handler(mockEvent, {} as Context);
        
        // Should complete with 0 successful queries due to table creation/insert failures
        expect(result).toEqual({
            message: "Merge operations completed: 0 tables successful, 1 failed, 1 total queries",
            numTables: 1, // Should find the source table but fail to process it
            successfulTables: 0,
            failedTables: 1,
            totalQueries: 1,
        });
    });

    describe("S3Config-specific behavior", () => {
        it("should use S3Config methods for database and bucket configuration", async () => {
            process.env.USE_S3_TABLE = "true";
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    { Name: "test-bucket_packages-view" },
                    { Name: "test-bucket_objects-view" },
                ],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            await handler(mockEvent, {} as Context);

            // Verify that S3Config's getWriteDatabaseName was used (S3TABLE_DATABASE_NAME)
            // and getTablesBucket was used (S3_TABLES_BUCKET)
            const startQueryCalls = athenaMock.commandCalls(StartQueryExecutionCommand);
            expect(startQueryCalls.length).toBeGreaterThan(0);
            
            // Check that queries use S3 database and execution context
            const firstCall = startQueryCalls[0];
            expect(firstCall.args[0].input.QueryExecutionContext?.Database).toBe("test-db"); // S3TABLE_DATABASE_NAME
            
            // Check that S3Config creates partitioned tables (instead of CTAS with LOCATION)
            const createTableCalls = startQueryCalls.filter(call => 
                call.args[0].input.QueryString?.includes("CREATE TABLE") &&
                call.args[0].input.QueryString?.includes("PARTITIONED BY")
            );
            expect(createTableCalls.length).toBeGreaterThan(0);
        });

        it("should use S3Config getExecutionContext with Catalog parameter", async () => {
            process.env.USE_S3_TABLE = "true";
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "test-bucket_packages-view" }],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            await handler(mockEvent, {} as Context);

            // Verify execution context includes both Catalog and Database for S3Config
            const startQueryCalls = athenaMock.commandCalls(StartQueryExecutionCommand);
            expect(startQueryCalls.length).toBeGreaterThan(0);
            
            const queryCall = startQueryCalls[0];
            expect(queryCall.args[0].input.QueryExecutionContext).toEqual({
                Database: "test-db", // S3Config uses s3TableDatabaseName
                Catalog: "s3tablescatalog/test-tables-bucket" // S3Config includes catalog in execution context
            });
        });

        it("should generate S3-specific table creation queries with PARTITIONED BY", async () => {
            process.env.USE_S3_TABLE = "true";
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "test-bucket_packages-view" }],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            await handler(mockEvent, {} as Context);

            // Check that S3Config uses partitioned table creation (not CTAS)
            const startQueryCalls = athenaMock.commandCalls(StartQueryExecutionCommand);
            const createTableCalls = startQueryCalls.filter(call => 
                call.args[0].input.QueryString?.includes("CREATE TABLE") &&
                call.args[0].input.QueryString?.includes("PARTITIONED BY")
            );
            expect(createTableCalls.length).toBeGreaterThan(0);
            
            // Verify the partitioned table creation
            const createTableQuery = createTableCalls[0].args[0].input.QueryString;
            expect(createTableQuery).toContain("PARTITIONED BY");
        });

        it("should use S3Config getResultsBucket for Athena results location", async () => {
            process.env.USE_S3_TABLE = "true";
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "test-bucket_packages-view" }],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            await handler(mockEvent, {} as Context);

            // Verify that S3Config's getResultsBucket was used for query output location
            const startQueryCalls = athenaMock.commandCalls(StartQueryExecutionCommand);
            expect(startQueryCalls.length).toBeGreaterThan(0);
            
            const queryCall = startQueryCalls[0];
            expect(queryCall.args[0].input.ResultConfiguration?.OutputLocation).toBe("s3://test-bucket/athena-results/");
        });

        it("should handle S3Config mode differences from Glue mode", async () => {
            // Test S3 mode
            process.env.USE_S3_TABLE = "true";
            
            glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "test-bucket_packages-view" }],
            });

            athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "s3-query-123",
            });

            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED },
                },
            });

            const mockEvent = createEventBridgeEvent();
            const s3Result = await handler(mockEvent, {} as Context);

            expect(s3Result?.message).toContain("Merge operations completed");

            // Verify S3Config uses partitioned table creation
            const s3QueryCalls = athenaMock.commandCalls(StartQueryExecutionCommand);
            const s3PartitionedCalls = s3QueryCalls.filter(call => 
                call.args[0].input.QueryString?.includes("PARTITIONED BY")
            );
            
            expect(s3QueryCalls.length).toBeGreaterThan(0);
            expect(s3PartitionedCalls.length).toBeGreaterThan(0);
        });
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
