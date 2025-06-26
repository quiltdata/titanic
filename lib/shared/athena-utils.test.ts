import { mockClient } from "aws-sdk-client-mock";
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { 
    glueClient, 
    athenaClient, 
    waitForQueryCompletion, 
    tableExists, 
    executeQuery, 
    sourceBucketFromTableName 
} from "./athena-utils";

const glueMock = mockClient(GlueClient);
const athenaMock = mockClient(AthenaClient);

describe("athena-utils", () => {
    beforeEach(() => {
        glueMock.reset();
        athenaMock.reset();
    });

    describe("sourceBucketFromTableName", () => {
        it("should extract bucket name from objects view table", () => {
            expect(sourceBucketFromTableName("test_bucket_objects-view")).toBe("test_bucket");
        });

        it("should extract bucket name from packages view table", () => {
            expect(sourceBucketFromTableName("prod_registry_packages-view")).toBe("prod_registry");
        });

        it("should handle edge cases", () => {
            expect(sourceBucketFromTableName("simple-view")).toBe("simple-view");
            expect(sourceBucketFromTableName("")).toBe("");
        });
    });

    describe("tableExists", () => {
        it("should return true when table exists", async () => {
            glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "package_revision" }]
            });

            const result = await tableExists("test-db", "package_revision");
            expect(result).toBe(true);
        });

        it("should return false when table does not exist", async () => {
            glueMock.on(GetTablesCommand).resolves({
                TableList: []
            });

            const result = await tableExists("test-db", "nonexistent_table");
            expect(result).toBe(false);
        });

        it("should handle undefined TableList", async () => {
            glueMock.on(GetTablesCommand).resolves({});

            const result = await tableExists("test-db", "package_revision");
            expect(result).toBe(false);
        });
    });

    describe("waitForQueryCompletion", () => {
        it("should resolve when query succeeds", async () => {
            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(waitForQueryCompletion("test-id")).resolves.toBeUndefined();
        });

        it("should reject when query fails", async () => {
            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { 
                        State: QueryExecutionState.FAILED,
                        StateChangeReason: "Query syntax error"
                    }
                }
            });

            await expect(waitForQueryCompletion("test-id")).rejects.toThrow("Query syntax error");
        });

        it("should reject when query is cancelled", async () => {
            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { 
                        State: QueryExecutionState.CANCELLED,
                        StateChangeReason: "User cancelled"
                    }
                }
            });

            await expect(waitForQueryCompletion("test-id")).rejects.toThrow("User cancelled");
        });

        it("should timeout after max attempts", async () => {
            athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.RUNNING }
                }
            });

            await expect(waitForQueryCompletion("test-id", 2)).rejects.toThrow("Query timed out after 2 attempts");
        }, 10000);
    });

    describe("executeQuery", () => {
        it("should execute query successfully", async () => {
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQuery("SELECT 1", "test-bucket")).resolves.toBeUndefined();
        });

        it("should throw error when QueryExecutionId is missing", async () => {
            athenaMock.on(StartQueryExecutionCommand).resolves({});

            await expect(executeQuery("SELECT 1", "test-bucket")).rejects.toThrow("Failed to get QueryExecutionId");
        });
    });
});
