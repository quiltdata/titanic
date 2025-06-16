import { Context } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

const cloudWatchMock = mockClient(CloudWatchLogsClient);

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
        cloudWatchMock.reset();
    });

    it("should throw error if environment variables are missing", async () => {
        delete process.env.DATABASE_NAME;
        const mockEvent: any = {
            messageType: "DATA_MESSAGE",
            owner: "123456789012",
            logGroup: "test-log-group",
            logStream: "test-log-stream",
            subscriptionFilters: ["test-subscription-filter"],
            logEvents: [
                {
                    id: "event-id",
                    timestamp: new Date().getTime(),
                    message: JSON.stringify({
                        version: "0.1",
                        type: "created",
                        bucket: "example",
                        handle: "some/package",
                        topHash: "a0fddace2eb2fd91faa697d237a5dbdcfa77f0fd38ca8b4c850dbd93d142ee69"
                    }),
                },
            ],
        };
        await expect(handler(mockEvent, {} as Context)).rejects.toThrow(
            "Missing required environment variables"
        );
    });

    it("should handle empty table list gracefully", async () => {
        glueMock.on(GetTablesCommand).resolves({
            TableList: [],
            NextToken: undefined,
        });

        const mockEvent: any = {
            messageType: "DATA_MESSAGE",
            owner: "123456789012",
            logGroup: "test-log-group",
            logStream: "test-log-stream",
            subscriptionFilters: ["test-subscription-filter"],
            logEvents: [
                {
                    id: "event-id",
                    timestamp: new Date().getTime(),
                    message: JSON.stringify({
                        version: "0",
                        id: "6425eb6a-9627-e6a1-2ae8-9d2d8883dc74",
                        "detail-type": "package-revision",
                        source: "com.quiltdata",
                        account: "012345678901",
                        time: "2024-04-25T14:46:51Z",
                        region: "us-east-1",
                        resources: [],
                        detail: {
                            version: "0.1",
                            type: "created",
                            bucket: "example",
                            handle: "some/package",
                            topHash: "a0fddace2eb2fd91faa697d237a5dbdcfa77f0fd38ca8b4c850dbd93d142ee69"
                        }
                    }),
                },
            ],
        };

        const result = await handler(mockEvent, {} as Context);

        expect(result).toEqual({
            message: "No tables found to merge",
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

        const mockEvent: any = {
            messageType: "DATA_MESSAGE",
            owner: "123456789012",
            logGroup: "test-log-group",
            logStream: "test-log-stream",
            subscriptionFilters: ["test-subscription-filter"],
            logEvents: [
                {
                    id: "event-id",
                    timestamp: new Date().getTime(),
                    message: JSON.stringify({
                        version: "0",
                        id: "6425eb6a-9627-e6a1-2ae8-9d2d8883dc74",
                        "detail-type": "package-revision",
                        source: "com.quiltdata",
                        account: "012345678901",
                        time: "2024-04-25T14:46:51Z",
                        region: "us-east-1",
                        resources: [],
                        detail: {
                            version: "0.1",
                            type: "created",
                            bucket: "example",
                            handle: "some/package",
                            topHash: "a0fddace2eb2fd91faa697d237a5dbdcfa77f0fd38ca8b4c850dbd93d142ee69"
                        }
                    }),
                },
            ],
        };

        const result = await handler(mockEvent, {} as Context);

        expect(result).toEqual({
            message: "Merge queries started successfully",
            numTables: 2,
        });
    });
});
