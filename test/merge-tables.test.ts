import { Context, EventBridgeEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";

jest.setTimeout(30000); // Increase timeout to 30 seconds
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { handler } from "../lib/merge-tables";

// EventBridge event detail structure
interface PackageEventDetail {
    version: string;
    type: string;
    bucket: string;
    handle: string;
    topHash: string;
}

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
        glueMock.reset();
        athenaMock.reset();
    });

    it("should throw error if environment variables are missing", async () => {
        delete process.env.DATABASE_NAME;
        const mockEvent = createEventBridgeEvent();
        await expect(handler(mockEvent, {} as Context)).rejects.toThrow(
            "Missing required environment variables",
        );
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
                    Name: "test_bucket_objects-view",
                    StorageDescriptor: { Location: "s3://test-bucket/objects" },
                },
                {
                    Name: "test_bucket_packages-view",
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
            message: "Merge queries completed successfully",
            numTables: 2, // Should find test_bucket_objects-view and test_bucket_packages-view
        });
    });

    describe("bucket-based filtering", () => {
        it("should handle EventBridge events with bucket filtering", async () => {
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    {
                        Name: "test_bucket_objects-view",
                        StorageDescriptor: { Location: "s3://test/objects" },
                    },
                    {
                        Name: "prod_bucket_objects-view",
                        StorageDescriptor: { Location: "s3://prod/objects" },
                    },
                    {
                        Name: "dev_bucket_objects-view",
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
                message: "Merge queries completed successfully",
                numTables: 1, // Should find test_bucket_objects-view
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

    it("should handle Athena query failures", async () => {
        // Mock tables response with a view table to ensure merge is attempted
        glueMock.on(GetTablesCommand).resolves({
            TableList: [
                {
                    Name: "test_bucket_objects-view",
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

        // Test that the Athena error is propagated
        const mockEvent = createEventBridgeEvent();
        await expect(handler(mockEvent, {} as Context)).rejects.toThrow(
            "Athena error",
        );
    });
});
