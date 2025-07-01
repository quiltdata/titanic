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
    executeQueryWithRetry,
    dropAllTitanicTables,
    validateQuery,
    sourceBucketFromTableName 
} from "./athena-utils";
import { Config, S3Config } from "./config";

const glueMock = mockClient(GlueClient);
const athenaMock = mockClient(AthenaClient);

describe("athena-utils", () => {
    let config: Config;
    let s3Config: S3Config;

    beforeEach(() => {
        glueMock.reset();
        athenaMock.reset();
        
        config = Config.createTestInstance({
            glueTablesBucket: 'test-glue-bucket',
            s3TablesBucket: 'test-s3-bucket',
            aws_region: 'us-east-1',
            glueDatabaseName: 'test_glue_db',
            s3TableDatabaseName: 'test_s3_db'
        });

        s3Config = S3Config.createTestInstance({
            glueTablesBucket: 'test-glue-bucket',
            s3TablesBucket: 'test-s3-bucket',
            aws_region: 'us-east-1',
            glueDatabaseName: 'test_glue_db',
            s3TableDatabaseName: 'test_s3_db'
        });
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

            const result = await tableExists(config, "package_revision");
            expect(result).toBe(true);
        });

        it("should return false when table does not exist", async () => {
            glueMock.on(GetTablesCommand).resolves({
                TableList: []
            });

            const result = await tableExists(config, "nonexistent_table");
            expect(result).toBe(false);
        });

        it("should handle undefined TableList", async () => {
            glueMock.on(GetTablesCommand).resolves({});

            const result = await tableExists(config, "package_revision");
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
        it("should execute read query successfully", async () => {
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQuery("SELECT 1", config)).resolves.toBeUndefined();
            
            const startQueryCall = athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(startQueryCall.args[0].input.QueryExecutionContext).toEqual({
                Database: "test_glue_db"
            });
            expect(startQueryCall.args[0].input.ResultConfiguration).toEqual({
                OutputLocation: "s3://test-glue-bucket/athena-results/"
            });
        });

        it("should execute write query successfully with correct database", async () => {
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQuery("CREATE TABLE test AS SELECT 1", config)).resolves.toBeUndefined();
            
            const startQueryCall = athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(startQueryCall.args[0].input.QueryExecutionContext).toEqual({
                Database: "test_glue_db" // For non-S3 config, write uses same as read
            });
        });

        it("should use S3 database for S3 table configuration", async () => {
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQuery("CREATE TABLE test AS SELECT 1", s3Config)).resolves.toBeUndefined();
            
            const startQueryCall = athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(startQueryCall.args[0].input.QueryExecutionContext).toEqual({
                Database: "test_s3_db"
            });
        });

        it("should execute query with correct result configuration", async () => {
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQuery("SELECT 1", config)).resolves.toBeUndefined();
            
            const startQueryCall = athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(startQueryCall.args[0].input.ResultConfiguration?.OutputLocation).toBe(
                "s3://test-glue-bucket/athena-results/"
            );
        });

        it("should throw error when QueryExecutionId is missing", async () => {
            athenaMock.on(StartQueryExecutionCommand).resolves({});

            await expect(executeQuery("SELECT 1", config)).rejects.toThrow("Failed to get QueryExecutionId");
        });
    });

    describe("validateQuery", () => {
        it("should validate safe CREATE TABLE queries", () => {
            const result = validateQuery("CREATE TABLE test AS SELECT * FROM source");
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("should validate safe INSERT INTO queries", () => {
            const result = validateQuery("INSERT INTO test SELECT * FROM source");
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("should reject dangerous DROP queries", () => {
            const result = validateQuery("SELECT * FROM test; DROP TABLE users");
            expect(result.isValid).toBe(false);
            expect(result.errors).toContainEqual(expect.stringContaining("dangerous SQL pattern"));
        });

        it("should reject queries without CREATE TABLE or INSERT INTO", () => {
            const result = validateQuery("SELECT * FROM test");
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain("Query must be a CREATE TABLE or INSERT INTO statement");
        });
    });

    describe("executeQueryWithRetry", () => {
        it("should retry failed queries", async () => {
            athenaMock
                .on(StartQueryExecutionCommand)
                .rejectsOnce(new Error("Network error"))
                .resolvesOnce({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await expect(executeQueryWithRetry("SELECT 1", config, 2, 10)).resolves.toBeUndefined();
        });

        it("should throw error after max retries", async () => {
            athenaMock.on(StartQueryExecutionCommand).rejects(new Error("Network error"));

            await expect(executeQueryWithRetry("SELECT 1", config, 2, 10))
                .rejects.toThrow("Query failed after 2 attempts: Network error");
        });
    });
});
