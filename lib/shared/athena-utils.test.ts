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

            await expect(athenaUtils.waitForQueryCompletion("test-id")).resolves.toBeUndefined();
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

            await expect(athenaUtils.executeQuery("SELECT 1")).resolves.toBeUndefined();
            
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

            await expect(s3AthenaUtils.executeQuery("CREATE TABLE test AS SELECT 1")).resolves.toBeUndefined();
            
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

            await expect(athenaUtils.executeQuery("SELECT 1")).rejects.toThrow("Failed to start query");
        });
    });

    describe("getAllTables", () => {
        it("should return all tables with pagination", async () => {
            athenaUtils.glueMock.on(GetTablesCommand)
                .resolvesOnce({
                    TableList: [{ Name: "table1" }, { Name: "table2" }],
                    NextToken: "token1"
                })
                .resolvesOnce({
                    TableList: [{ Name: "table3" }]
                });

            const result = await athenaUtils.getAllTables("test_db");
            expect(result).toHaveLength(3);
            expect(result).toEqual(["table1", "table2", "table3"]);
        });

        it("should handle empty table list", async () => {
            athenaUtils.glueMock.on(GetTablesCommand).resolves({});

            const result = await athenaUtils.getAllTables("test_db");
            expect(result).toHaveLength(0);
        });
    });

    describe("S3Config-specific tests", () => {
        it("should use S3Config getWriteDatabaseName for S3 operations", () => {
            expect(config.getWriteDatabaseName()).toBe(TEST_CONFIG_PARAMS.glueDatabaseName);
            expect(s3Config.getWriteDatabaseName()).toBe(TEST_CONFIG_PARAMS.s3TableDatabaseName);
        });

        it("should use S3Config getTargetBucket for S3 table storage", () => {
            expect(config.getTargetBucket()).toBe(TEST_GLUE_BUCKET);
            expect(s3Config.getTargetBucket()).toBe(TEST_S3_BUCKET);
        });

        it("should use S3Config getResultsBucket for Athena results", () => {
            // Both should use Glue bucket for Athena results
            expect(config.getResultsBucket()).toBe(TEST_GLUE_BUCKET);
            expect(s3Config.getResultsBucket()).toBe(TEST_GLUE_BUCKET);
        });

        it("should use S3Config getS3TableCatalogName for catalog operations", () => {
            expect(s3Config.getS3TableCatalogName()).toBe(TEST_S3_CATALOG_NAME);
        });

        it("should generate different createTableQuery for S3Config vs Config", () => {
            const tableName = "test_table";
            const columns = "id STRING, name STRING";
            
            const configQuery = config.createTableQuery(tableName, columns);
            const s3ConfigQuery = s3Config.createTableQuery(tableName, columns);
            
            expect(configQuery).toContain("WITH (format = 'iceberg')");
            expect(s3ConfigQuery).toContain(`LOCATION 's3://${TEST_S3_BUCKET}/test_table/'`);
            expect(s3ConfigQuery).not.toContain("WITH (format = 'iceberg')");
        });

        it("should provide different execution contexts for S3Config vs Config", () => {
            const configContext = config.getExecutionContext();
            const s3ConfigContext = s3Config.getExecutionContext();
            
            expect(configContext).toEqual({ Database: TEST_CONFIG_PARAMS.glueDatabaseName });
            expect(s3ConfigContext).toEqual({
                Catalog: TEST_S3_CATALOG_NAME,
                Database: TEST_CONFIG_PARAMS.s3TableDatabaseName
            });
        });

        it("should execute queries with S3Config execution context including catalog", async () => {
            s3AthenaUtils.athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "test-s3-execution-id"
            });
            s3AthenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(s3AthenaUtils.executeQuery("SELECT * FROM test_table")).resolves.toBeUndefined();
            
            expect(s3AthenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)).toHaveLength(1);
            const call = s3AthenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(call.args[0].input).toMatchObject({
                QueryString: "SELECT * FROM test_table",
                QueryExecutionContext: { 
                    Catalog: TEST_S3_CATALOG_NAME,
                    Database: TEST_CONFIG_PARAMS.s3TableDatabaseName
                },
                ResultConfiguration: { OutputLocation: `s3://${TEST_GLUE_BUCKET}/athena-results/` }
            });
        });

        it("should use S3Config getReadDatabaseName consistently", () => {
            expect(config.getReadDatabaseName()).toBe(TEST_CONFIG_PARAMS.glueDatabaseName);
            expect(s3Config.getReadDatabaseName()).toBe(TEST_CONFIG_PARAMS.glueDatabaseName); // S3Config inherits this from base
        });

        it("should handle dropTableQuery identically for both configs", () => {
            const tableName = "test_table";
            
            const configDropQuery = config.dropTableQuery(tableName);
            const s3ConfigDropQuery = s3Config.dropTableQuery(tableName);
            
            expect(configDropQuery).toBe("DROP TABLE IF EXISTS test_table");
            expect(s3ConfigDropQuery).toBe("DROP TABLE IF EXISTS test_table");
        });

        it("should extract source bucket names consistently for both config types", () => {
            const packagesTableName = `${TEST_S3_BUCKET}_packages-view`;
            const objectsTableName = `${TEST_S3_BUCKET}_objects-view`;
            
            expect(Config.sourceBucketFromTableName(packagesTableName)).toBe(TEST_S3_BUCKET);
            expect(Config.sourceBucketFromTableName(objectsTableName)).toBe(TEST_S3_BUCKET);
            expect(S3Config.sourceBucketFromTableName(packagesTableName)).toBe(TEST_S3_BUCKET);
            expect(S3Config.sourceBucketFromTableName(objectsTableName)).toBe(TEST_S3_BUCKET);
        });
    });
});
