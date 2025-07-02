import { GetTablesCommand } from "@aws-sdk/client-glue";
import { GetQueryExecutionCommand, QueryExecutionState, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { AthenaUtils } from "./athena-utils";
import { Config, S3Config } from "./config";

describe("AthenaUtils", () => {
    let config: Config;
    let s3Config: S3Config;
    let athenaUtils: AthenaUtils;
    let s3AthenaUtils: AthenaUtils;

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
        athenaUtils = AthenaUtils.createTestInstance(config);
        s3AthenaUtils = AthenaUtils.createTestInstance(s3Config);
        
        // Reset mocks before each test
        athenaUtils.glueMock?.reset();
        athenaUtils.athenaMock?.reset();
        s3AthenaUtils.glueMock?.reset();
        s3AthenaUtils.athenaMock?.reset();
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
            
            // Verify the queries use fully qualified table names with target database
            const calls = athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand);
            expect(calls[0].args[0].input.QueryString).toBe("DROP TABLE IF EXISTS target_db.package_revision");
            expect(calls[1].args[0].input.QueryString).toBe("DROP TABLE IF EXISTS target_db.package_tag");
            expect(calls[2].args[0].input.QueryString).toBe("DROP TABLE IF EXISTS target_db.package_entry");
            
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
            
            // Verify the query uses fully qualified table name with default database
            const athenaCall = athenaUtils.athenaMock.commandCalls(StartQueryExecutionCommand)[0];
            expect(athenaCall.args[0].input.QueryString).toBe("DROP TABLE IF EXISTS test_glue_db.package_revision");
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
});
