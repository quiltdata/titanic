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
        process.env.DATABASE_NAME = "test-db";
        process.env.TARGET_BUCKET = "test-bucket";
        process.env.LAMBDA_TIMEOUT = "5000";
        delete process.env.USE_S3_TABLE; // Default to Iceberg mode
        glueMock.reset();
        athenaMock.reset();
        
        // Reset fs mocks
        mockFs.existsSync.mockReturnValue(true); // Default: not first run
        mockFs.writeFileSync.mockImplementation(() => {});
    });

    describe("environment variable handling", () => {
        it("should throw error if environment variables are missing", async () => {
            delete process.env.DATABASE_NAME;
            const mockEvent = createEventBridgeEvent();
            await expect(handler(mockEvent, {} as Context)).rejects.toThrow(
                "Missing required environment variables DATABASE_NAME or TARGET_BUCKET",
            );
        });

        it("should use S3 Tables mode when USE_S3_TABLE=true", async () => {
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

            expect(result?.message).toContain("successful queries");
        });

        it("should use Iceberg mode when USE_S3_TABLE=false or undefined", async () => {
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

            expect(result?.message).toContain("successful queries");
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
            message: "Merge operations completed: 3 successful queries",
            numTables: 2, // Should find test-bucket_objects-view and test-bucket_packages-view
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
                message: "Merge operations completed: 1 successful queries",
                numTables: 1, // Should find test-bucket_objects-view
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
            message: "Merge operations completed: 0 successful queries",
            numTables: 1, // Should find the source table but fail to process it
        });
    });
});
