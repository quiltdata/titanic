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
        it("should execute query successfully for Iceberg tables", async () => {
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQuery("SELECT 1", "test-bucket", "test-db", false)).resolves.toBeUndefined();
        });

        it("should execute query successfully for S3 Tables with correct catalog", async () => {
            // Set environment variable for Athena results bucket
            process.env.ATHENA_RESULTS_BUCKET = "athena-results-bucket";
            
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            // Test with S3 Tables ARN
            const s3TablesArn = "arn:aws:s3tables:us-east-1:123456789012:bucket/test-bucket";
            await expect(executeQuery("SELECT 1", s3TablesArn, "quilt_titanic", true)).resolves.toBeUndefined();
            
            // Verify that the correct QueryExecutionContext was set for S3 Tables
            const startQueryCall = athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(startQueryCall.args[0].input.QueryExecutionContext).toEqual({
                Catalog: "s3tablescatalog/test-bucket",
                Database: "quilt_titanic"
            });
            
            // Verify that Athena results go to the separate bucket
            expect(startQueryCall.args[0].input.ResultConfiguration?.OutputLocation).toBe(
                "s3://athena-results-bucket/athena-results/"
            );
            
            // Clean up
            delete process.env.ATHENA_RESULTS_BUCKET;
        });

        it("should execute query with database context for Iceberg tables", async () => {
            // Set the environment variable for the test
            process.env.ATHENA_RESULTS_BUCKET = "test-bucket";
            
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQuery("SELECT 1", "test-bucket", "test-db", false)).resolves.toBeUndefined();
            
            // Verify that QueryExecutionContext was set with database for Iceberg tables
            const startQueryCall = athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(startQueryCall.args[0].input.QueryExecutionContext).toEqual({
                Database: "test-db"
            });
            
            // Verify that results go to the target bucket
            expect(startQueryCall.args[0].input.ResultConfiguration?.OutputLocation).toBe(
                "s3://test-bucket/athena-results/"
            );
            
            // Clean up
            delete process.env.ATHENA_RESULTS_BUCKET;
        });

        it("should throw error when QueryExecutionId is missing", async () => {
            athenaMock.on(StartQueryExecutionCommand).resolves({});

            await expect(executeQuery("SELECT 1", "test-bucket", "test-db", false)).rejects.toThrow("Failed to get QueryExecutionId");
        });
    });
});
