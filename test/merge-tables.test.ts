import { Context, SQSEvent } from "aws-lambda";
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

const glueMock = mockClient(GlueClient);
const athenaMock = mockClient(AthenaClient);

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
        const mockEvent: SQSEvent = {
            Records: [],
        };
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

        const mockEvent: SQSEvent = {
            Records: [{
                messageId: "1",
                receiptHandle: "handle",
                body: "{}",
                attributes: {
                    ApproximateReceiveCount: "1",
                    SentTimestamp: "1",
                    SenderId: "sender",
                    ApproximateFirstReceiveTimestamp: "1",
                },
                messageAttributes: {},
                md5OfBody: "md5",
                eventSource: "aws:sqs",
                eventSourceARN: "arn:aws:sqs:region:account:queue",
                awsRegion: "region",
            }],
        };
        const result = await handler(mockEvent, {} as Context);
        expect(result).toEqual({
            message: "Created merged table (no source tables found)",
            numTables: 0,
        });
    });

    it("should successfully merge S3-backed tables", async () => {
        glueMock.on(GetTablesCommand).resolves({
            TableList: [
                {
                    Name: "bucket1_objects-view",
                    StorageDescriptor: { Location: "s3://bucket1/objects" },
                },
                {
                    Name: "bucket2_objects-view",
                    StorageDescriptor: { Location: "s3://bucket2/objects" },
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

        const mockEvent: SQSEvent = {
            Records: [{
                messageId: "1",
                receiptHandle: "handle",
                body: "{}",
                attributes: {
                    ApproximateReceiveCount: "1",
                    SentTimestamp: "1",
                    SenderId: "sender",
                    ApproximateFirstReceiveTimestamp: "1",
                },
                messageAttributes: {},
                md5OfBody: "md5",
                eventSource: "aws:sqs",
                eventSourceARN: "arn:aws:sqs:region:account:queue",
                awsRegion: "region",
            }],
        };
        const result = await handler(mockEvent, {} as Context);

        expect(result).toEqual({
            message: "Merge queries started successfully",
            numTables: 2,
        });
    });

    describe("table prefix filtering", () => {
        it("should handle SQS events with table prefix", async () => {
            glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    {
                        Name: "test_objects-view",
                        StorageDescriptor: { Location: "s3://test/objects" },
                    },
                    {
                        Name: "prod_objects-view",
                        StorageDescriptor: { Location: "s3://prod/objects" },
                    },
                    {
                        Name: "dev_objects-view",
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

            const sqsEvent: SQSEvent = {
                Records: [{
                    messageId: "1",
                    receiptHandle: "handle",
                    body: JSON.stringify({ table_prefix: "test" }),
                    attributes: {
                        ApproximateReceiveCount: "1",
                        SentTimestamp: "1",
                        SenderId: "sender",
                        ApproximateFirstReceiveTimestamp: "1",
                    },
                    messageAttributes: {},
                    md5OfBody: "md5",
                    eventSource: "aws:sqs",
                    eventSourceARN: "arn:aws:sqs:region:account:queue",
                    awsRegion: "region",
                }],
            };

            const result = await handler(sqsEvent, {} as Context);
            expect(result).toEqual({
                message: "Merge queries started successfully",
                numTables: 1, // Should find test_objects-view
            });
        });

        it("should handle invalid table prefix gracefully", async () => {
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

            const sqsEvent: SQSEvent = {
                Records: [{
                    messageId: "1",
                    receiptHandle: "handle",
                    body: JSON.stringify({ table_prefix: "nonexistent" }),
                    attributes: {
                        ApproximateReceiveCount: "1",
                        SentTimestamp: "1",
                        SenderId: "sender",
                        ApproximateFirstReceiveTimestamp: "1",
                    },
                    messageAttributes: {},
                    md5OfBody: "md5",
                    eventSource: "aws:sqs",
                    eventSourceARN: "arn:aws:sqs:region:account:queue",
                    awsRegion: "region",
                }],
            };

            const result = await handler(sqsEvent, {} as Context);
            expect(result).toEqual({
                message: "Created merged table (no source tables found)",
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

        const mockEvent: SQSEvent = {
            Records: [{
                messageId: "1",
                receiptHandle: "handle",
                body: "{}",
                attributes: {
                    ApproximateReceiveCount: "1",
                    SentTimestamp: "1",
                    SenderId: "sender",
                    ApproximateFirstReceiveTimestamp: "1",
                },
                messageAttributes: {},
                md5OfBody: "md5",
                eventSource: "aws:sqs",
                eventSourceARN: "arn:aws:sqs:region:account:queue",
                awsRegion: "region",
            }],
        };
        const result = await handler(mockEvent, {} as Context);
        expect(result).toBeDefined();
    });

    it("should handle Athena query failures", async () => {
        // Mock tables response with a view table to ensure merge is attempted
        glueMock.on(GetTablesCommand).resolves({
            TableList: [
                {
                    Name: "table1-view",
                    StorageDescriptor: { Location: "s3://bucket/table1" },
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
        const mockEvent: SQSEvent = {
            Records: [{
                messageId: "1",
                receiptHandle: "handle",
                body: "{}",
                attributes: {
                    ApproximateReceiveCount: "1",
                    SentTimestamp: "1",
                    SenderId: "sender",
                    ApproximateFirstReceiveTimestamp: "1",
                },
                messageAttributes: {},
                md5OfBody: "md5",
                eventSource: "aws:sqs",
                eventSourceARN: "arn:aws:sqs:region:account:queue",
                awsRegion: "region",
            }],
        };
        await expect(handler(mockEvent, {} as Context)).rejects.toThrow(
            "Athena error",
        );
    });

    it("should only merge from the bucket in EventBridge event", async () => {
        glueMock.on(GetTablesCommand).resolves({
            TableList: [
                { Name: "example_objects-view", StorageDescriptor: { Location: "s3://example/objects" } },
                { Name: "otherbucket_objects-view", StorageDescriptor: { Location: "s3://otherbucket/objects" } },
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

        // Simulate EventBridge event with detail.bucket
        const eventBridgeEvent: any = {
            Records: [],
            detail: {
                bucket: "example",
            },
        };
        const result = await handler(eventBridgeEvent, {} as Context);
        expect(result).toEqual({
            message: "Merge queries started successfully",
            numTables: 1, // Only 'example_objects-view' should be merged
        });
    });

    it("should issue correct CREATE TABLE queries for base tables", async () => {
        glueMock.on(GetTablesCommand).resolves({
            TableList: [],
            NextToken: undefined,
        });

        // Track all StartQueryExecutionCommand calls
        const startQueryCalls: any[] = [];
        athenaMock.on(StartQueryExecutionCommand).callsFake((input) => {
            startQueryCalls.push(input);
            return { QueryExecutionId: "test-create-id" };
        });
        athenaMock.on(GetQueryExecutionCommand).resolves({
            QueryExecution: {
                Status: { State: QueryExecutionState.SUCCEEDED },
            },
        });

        const mockEvent: SQSEvent = {
            Records: [{
                messageId: "1",
                receiptHandle: "handle",
                body: "{}",
                attributes: {
                    ApproximateReceiveCount: "1",
                    SentTimestamp: "1",
                    SenderId: "sender",
                    ApproximateFirstReceiveTimestamp: "1",
                },
                messageAttributes: {},
                md5OfBody: "md5",
                eventSource: "aws:sqs",
                eventSourceARN: "arn:aws:sqs:region:account:queue",
                awsRegion: "region",
            }],
        };
        await handler(mockEvent, {} as Context);

        // Find CREATE TABLE queries for base tables
        const createPackages = startQueryCalls.find(call => call.QueryString.includes('CREATE TABLE IF NOT EXISTS "test-db"."packages"'));
        const createObjects = startQueryCalls.find(call => call.QueryString.includes('CREATE TABLE IF NOT EXISTS "test-db"."objects"'));
        expect(createPackages).toBeDefined();
        expect(createObjects).toBeDefined();
        expect(createPackages.QueryString).toContain('table_type = \'ICEBERG\'');
        expect(createObjects.QueryString).toContain('table_type = \'ICEBERG\'');
    });
});
