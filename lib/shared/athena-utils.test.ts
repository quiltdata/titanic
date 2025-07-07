import { GetTablesCommand } from "@aws-sdk/client-glue";
import { GetQueryExecutionCommand, QueryExecutionState, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { AthenaTest } from "./athena-test";
import { Config, S3Config } from "./config";

const TEST_S3_BUCKET = 'test-s3-bucket';
const TEST_GLUE_BUCKET = 'test-glue-bucket';
const TEST_CONFIG_PARAMS = {
    aws_region: "us-east-1",
    glueTablesBucketArn: `arn:aws:s3:::${TEST_GLUE_BUCKET}`,
    glueDatabaseName: "test-db",
    s3TablesBucketArn: `arn:aws:s3tables:us-east-1:123456789012:bucket/${TEST_S3_BUCKET}`,
    s3TableDatabaseName: "test-s3-db"
};

const TEST_S3_CATALOG_NAME = `s3tablescatalog/${TEST_S3_BUCKET}`;

describe("AthenaUtils", () => {
    let config: Config;
    let s3Config: S3Config;
    let athenaUtils: AthenaTest;
    let s3AthenaUtils: AthenaTest;

    beforeEach(() => {
        config = Config.createTestInstance(TEST_CONFIG_PARAMS);

        s3Config = S3Config.createTestInstance(TEST_CONFIG_PARAMS);

        // Use test instances with internal mocked clients
        athenaUtils = AthenaTest.createTestInstance(config);
        s3AthenaUtils = AthenaTest.createTestInstance(s3Config);
        
        // Reset mocks before each test
        athenaUtils.resetMocks();
        s3AthenaUtils.resetMocks();
    });

    describe("waitForQueryCompletion", () => {
        it("should resolve when query succeeds", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id")).resolves.toEqual({
                Status: { State: QueryExecutionState.SUCCEEDED }
            });
        });

        it("should reject when query fails", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { 
                        State: QueryExecutionState.FAILED,
                        StateChangeReason: "Query syntax error"
                    }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id")).rejects.toThrow("Query syntax error");
        });

        it("should reject when query is cancelled", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { 
                        State: QueryExecutionState.CANCELLED,
                        StateChangeReason: "User cancelled"
                    }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id")).rejects.toThrow("User cancelled");
        });

        it("should timeout after max attempts", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.RUNNING }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id", 2)).rejects.toThrow("Query timed out after 2 attempts");
        });
    });

    describe("executeQuery", () => {
        it("should execute query successfully with Glue config", async () => {
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "test-execution-id"
            });
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(athenaUtils.executeQuery("SELECT 1")).resolves.toEqual({
                success: true,
                rowsReturned: 0,
                queryId: "test-execution-id"
            });
            
            expect(athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)).toHaveLength(1);
            const call = athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(call.args[0].input).toMatchObject({
                QueryString: "SELECT 1",
                QueryExecutionContext: { Database: TEST_CONFIG_PARAMS.glueDatabaseName },
                ResultConfiguration: { OutputLocation: `s3://${TEST_GLUE_BUCKET}/athena-results/` }
            });
        });

        it("should execute query successfully with S3 config", async () => {
            s3AthenaUtils.athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "test-execution-id"
            });
            s3AthenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(s3AthenaUtils.executeQuery("CREATE TABLE test AS SELECT 1")).resolves.toEqual({
                success: true,
                rowsReturned: 0,
                queryId: "test-execution-id"
            });
            
            expect(s3AthenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)).toHaveLength(1);
            const call = s3AthenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(call.args[0].input).toMatchObject({
                QueryString: "CREATE TABLE test AS SELECT 1",
                QueryExecutionContext: { 
                    Catalog: TEST_S3_CATALOG_NAME,
                    Database: TEST_CONFIG_PARAMS.s3TableDatabaseName 
                },
                ResultConfiguration: { OutputLocation: `s3://${TEST_GLUE_BUCKET}/athena-results/` }
            });
        });

        it("should handle missing QueryExecutionId", async () => {
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).resolves({});

            await expect(athenaUtils.executeQuery("SELECT 1")).resolves.toEqual({
                success: false,
                rowsReturned: 0,
                error: "Failed to start query"
            });
        });

        it("should handle S3 bucket access errors", async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).rejects(
                new Error('Cannot find or access the specified bucket')
            );

            const result = await athenaUtils.executeQuery("SELECT 1");
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Cannot find or access the specified bucket');
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('S3 Bucket Access Problem Detected'),
                expect.objectContaining({
                    issue: 'The Athena results bucket does not exist or is not accessible'
                })
            );
            
            consoleSpy.mockRestore();
        });

        it("should handle non-Error exceptions", async () => {
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).rejects('String error');

            const result = await athenaUtils.executeQuery("SELECT 1");
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('String error');
        });
    });

    describe("waitForQueryCompletion", () => {
        it("should resolve when query succeeds", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id")).resolves.toEqual({
                Status: { State: QueryExecutionState.SUCCEEDED }
            });
        });

        it("should reject when query fails", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { 
                        State: QueryExecutionState.FAILED,
                        StateChangeReason: "Query syntax error"
                    }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id")).rejects.toThrow("Query syntax error");
        });

        it("should reject when query is cancelled", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { 
                        State: QueryExecutionState.CANCELLED,
                        StateChangeReason: "User cancelled"
                    }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id")).rejects.toThrow("User cancelled");
        });

        it("should timeout after max attempts", async () => {
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.RUNNING }
                }
            });

            await expect(athenaUtils.waitForQueryCompletion("test-id", 2)).rejects.toThrow("Query timed out after 2 attempts");
        });
    });

    describe("constructor and configuration validation", () => {
        it("should log configuration issues when config is missing required values", () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            // Create a config with missing required values
            const badConfig = Config.createTestInstance({
                glueDatabaseName: "",
                glueTablesBucketArn: ""
            });
            
            // Creating AthenaUtils should trigger validation
            AthenaTest.createTestInstance(badConfig);
            
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Configuration issues detected'),
                expect.objectContaining({
                    issues: expect.arrayContaining([
                        expect.stringContaining('Results bucket is empty'),
                        expect.stringContaining('Write database name is empty'),
                        expect.stringContaining('Read database name is empty')
                    ])
                })
            );
            
            consoleSpy.mockRestore();
        });
    });

    describe("validateAthenaAccess", () => {
        it("should handle errors during validation", async () => {
            const athenaUtilsWithError = AthenaTest.createTestInstance(config);
            
            // Mock executeQuery to throw an error
            jest.spyOn(athenaUtilsWithError, 'executeQuery').mockRejectedValue(new Error('Connection failed'));
            
            const result = await athenaUtilsWithError.validateAthenaAccess();
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Connection failed');
            expect(result.testQuery).toBe('SELECT 1 AS test_connection');
        });
    });

    describe("executeQuery error handling", () => {
        it("should handle S3 bucket access errors", async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).rejects(
                new Error('Cannot find or access the specified bucket')
            );

            const result = await athenaUtils.executeQuery("SELECT 1");
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Cannot find or access the specified bucket');
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('S3 Bucket Access Problem Detected'),
                expect.objectContaining({
                    issue: 'The Athena results bucket does not exist or is not accessible'
                })
            );
            
            consoleSpy.mockRestore();
        });

        it("should handle non-Error exceptions", async () => {
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).rejects('String error');

            const result = await athenaUtils.executeQuery("SELECT 1");
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('String error');
        });
    });
});
