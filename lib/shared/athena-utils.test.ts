import { GetTablesCommand } from "@aws-sdk/client-glue";
import { GetQueryExecutionCommand, QueryExecutionState, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { AthenaUtils } from "./athena-utils";
import { AthenaTest } from "./athena-test";
import { Config, S3Config } from "./config";

describe("AthenaUtils", () => {
    let config: Config;
    let s3Config: S3Config;
    let athenaUtils: AthenaTest;
    let s3AthenaUtils: AthenaTest;

    beforeEach(() => {
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

        // Use test instances with internal mocked clients
        athenaUtils = AthenaTest.createTestInstance(config);
        s3AthenaUtils = AthenaTest.createTestInstance(s3Config);
        
        // Reset mocks before each test
        athenaUtils.resetMocks();
        s3AthenaUtils.resetMocks();
    });

    describe("tableExists", () => {
        it("should return true when table exists", async () => {
            athenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "package_revision" }]
            });

            const result = await athenaUtils.tableExists("package_revision");
            expect(result).toBe(true);
            
            // Verify it uses the default read database
            const call = athenaUtils.glueMock.commandCalls(GetTablesCommand)[0];
            expect(call.args[0].input.DatabaseName).toBe("test_glue_db");
        });

        it("should return true when table exists with specified database", async () => {
            athenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "package_revision" }]
            });

            const result = await athenaUtils.tableExists("package_revision", "custom_db");
            expect(result).toBe(true);
            
            // Verify it uses the specified database
            const call = athenaUtils.glueMock.commandCalls(GetTablesCommand)[0];
            expect(call.args[0].input.DatabaseName).toBe("custom_db");
        });

        it("should return false when table does not exist", async () => {
            athenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: []
            });

            const result = await athenaUtils.tableExists("nonexistent_table");
            expect(result).toBe(false);
        });

        it("should handle undefined TableList", async () => {
            athenaUtils.glueMock.on(GetTablesCommand).resolves({});

            const result = await athenaUtils.tableExists("package_revision");
            expect(result).toBe(false);
        });
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
                QueryExecutionContext: { Database: "test_glue_db" },
                ResultConfiguration: { OutputLocation: "s3://test-glue-bucket/athena-results/" }
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
                QueryExecutionContext: { Database: "test_s3_db" },
                ResultConfiguration: { OutputLocation: "s3://test-glue-bucket/athena-results/" }
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
            expect(result.map(t => t.Name)).toEqual(["table1", "table2", "table3"]);
        });

        it("should handle empty table list", async () => {
            athenaUtils.glueMock.on(GetTablesCommand).resolves({});

            const result = await athenaUtils.getAllTables("test_db");
            expect(result).toHaveLength(0);
        });
    });

    describe("dropAllTitanicTables", () => {
        it("should drop all tables when they exist with correct database context", async () => {
            // Mock tableExists to return true for all tables
            athenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: [
                    { Name: "package_revision" },
                    { Name: "package_tag" },
                    { Name: "package_entry" }
                ]
            });
            
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "test-execution-id"
            });
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(athenaUtils.dropAllTitanicTables("target_db")).resolves.toBeUndefined();
            
            // Should call executeQuery for each table that exists with qualified names
            expect(athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)).toHaveLength(3);
            
            // Verify the queries use table names without database prefix for target tables
            const calls = athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand);
            expect(calls[0].args[0].input.QueryString).toBe("DROP TABLE IF EXISTS package_revision");
            expect(calls[1].args[0].input.QueryString).toBe("DROP TABLE IF EXISTS package_tag");
            expect(calls[2].args[0].input.QueryString).toBe("DROP TABLE IF EXISTS package_entry");
            
            // Verify tableExists was called with the target database
            const glueCalls = athenaUtils.glueMock.commandCalls(GetTablesCommand);
            expect(glueCalls[0].args[0].input.DatabaseName).toBe("target_db");
        });

        it("should use write database when no database specified", async () => {
            athenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "package_revision" }]
            });
            
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: "test-execution-id"
            });
            athenaUtils.athenaMock.on(GetQueryExecutionCommand).resolves({
                QueryExecution: {
                    Status: { State: QueryExecutionState.SUCCEEDED }
                }
            });

            await expect(athenaUtils.dropAllTitanicTables()).resolves.toBeUndefined();
            
            // Verify the default write database is used
            const glueCall = athenaUtils.glueMock.commandCalls(GetTablesCommand)[0];
            expect(glueCall.args[0].input.DatabaseName).toBe("test_glue_db"); // write database for config
            
            // Verify the query uses table name without database prefix for target tables
            const athenaCall = athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(athenaCall.args[0].input.QueryString).toBe("DROP TABLE IF EXISTS package_revision");
        });

        it("should skip dropping tables when they don't exist", async () => {
            // Mock tableExists to return false for all tables
            athenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: []
            });

            await expect(athenaUtils.dropAllTitanicTables()).resolves.toBeUndefined();
            
            // Should not call any DROP commands since tables don't exist
            expect(athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)).toHaveLength(0);
        });

        it("should handle errors when dropping tables", async () => {
            // Mock tableExists to return true, but then fail on drop
            athenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "package_revision" }]
            });
            athenaUtils.athenaMock.on(StartQueryExecutionCommand).rejects(new Error("Drop failed"));

            // Should not throw error, just log it
            await expect(athenaUtils.dropAllTitanicTables()).resolves.toBeUndefined();
        });
    });

    describe("S3Config-specific tests", () => {
        it("should use S3Config getWriteDatabaseName for S3 operations", () => {
            expect(config.getWriteDatabaseName()).toBe("test_glue_db");
            expect(s3Config.getWriteDatabaseName()).toBe("test_s3_db");
        });

        it("should use S3Config getTablesBucket for S3 table storage", () => {
            expect(config.getTablesBucket()).toBe("test-glue-bucket");
            expect(s3Config.getTablesBucket()).toBe("test-s3-bucket");
        });

        it("should use S3Config getResultsBucket for Athena results", () => {
            // Both should use Glue bucket for Athena results
            expect(config.getResultsBucket()).toBe("test-glue-bucket");
            expect(s3Config.getResultsBucket()).toBe("test-glue-bucket");
        });

        it("should use S3Config getS3TableCatalogName for catalog operations", () => {
            expect(s3Config.getS3TableCatalogName()).toBe("test-s3-bucket");
        });

        it("should generate different createTableQuery for S3Config vs Config", () => {
            const tableName = "test_table";
            const columns = "id STRING, name STRING";
            
            const configQuery = config.createTableQuery(tableName, columns);
            const s3ConfigQuery = s3Config.createTableQuery(tableName, columns);
            
            expect(configQuery).toContain("WITH (format = 'iceberg')");
            expect(s3ConfigQuery).toContain("LOCATION 's3://test-s3-bucket/test_table/'");
            expect(s3ConfigQuery).not.toContain("WITH (format = 'iceberg')");
        });

        it("should provide different execution contexts for S3Config vs Config", () => {
            const configContext = config.getExecutionContext();
            const s3ConfigContext = s3Config.getExecutionContext();
            
            expect(configContext).toEqual({ Database: "test_glue_db" });
            expect(s3ConfigContext).toEqual({
                Catalog: "test-s3-bucket",
                Database: "test_s3_db"
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
                    Catalog: "test-s3-bucket",
                    Database: "test_s3_db" 
                },
                ResultConfiguration: { OutputLocation: "s3://test-glue-bucket/athena-results/" }
            });
        });

        it("should use S3Config getReadDatabaseName consistently", () => {
            expect(config.getReadDatabaseName()).toBe("test_glue_db");
            expect(s3Config.getReadDatabaseName()).toBe("test_glue_db"); // S3Config inherits this from base
        });

        it("should handle tableExists with S3Config database overrides", async () => {
            s3AthenaUtils.glueMock.on(GetTablesCommand).resolves({
                TableList: [{ Name: "test_table" }]
            });

            const result = await s3AthenaUtils.tableExists("test_table");
            expect(result).toBe(true);
            
            // Verify it uses the S3Config's read database
            const call = s3AthenaUtils.glueMock.commandCalls(GetTablesCommand)[0];
            expect(call.args[0].input.DatabaseName).toBe("test_glue_db");
        });

        it("should handle dropTableQuery identically for both configs", () => {
            const tableName = "test_table";
            
            const configDropQuery = config.dropTableQuery(tableName);
            const s3ConfigDropQuery = s3Config.dropTableQuery(tableName);
            
            expect(configDropQuery).toBe("DROP TABLE IF EXISTS test_table");
            expect(s3ConfigDropQuery).toBe("DROP TABLE IF EXISTS test_table");
        });

        it("should extract source bucket names consistently for both config types", () => {
            const packagesTableName = "test-bucket_packages-view";
            const objectsTableName = "test-bucket_objects-view";
            
            expect(Config.sourceBucketFromTableName(packagesTableName)).toBe("test-bucket");
            expect(Config.sourceBucketFromTableName(objectsTableName)).toBe("test-bucket");
            expect(S3Config.sourceBucketFromTableName(packagesTableName)).toBe("test-bucket");
            expect(S3Config.sourceBucketFromTableName(objectsTableName)).toBe("test-bucket");
        });
    });
});
