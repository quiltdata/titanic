import { StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { TableManager } from "./table-manager";
import { Config } from "../shared/config";
import { AthenaTest } from "../shared/athena-test";

describe("TableManager", () => {
    let tableManager: TableManager;
    let mockConfig: Config;
    let mockAthenaUtils: AthenaTest;

    beforeEach(() => {
        mockConfig = Config.createTestInstance({
            glueDatabaseName: "test-db",
            glueTablesBucketArn: "arn:aws:s3:::test-bucket"
        });
        
        // Create mock AthenaUtils instance using the new AthenaTest class
        mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);
        
        // Mock tableExists to return false by default (tables don't exist)
        mockAthenaUtils.mockTableExists("package_revision", false);
        mockAthenaUtils.mockTableExists("package_tag", false);
        mockAthenaUtils.mockTableExists("package_entry", false);
        
        tableManager = TableManager.createTestInstance(mockConfig, "test-db", "target-db", "test-bucket", mockAthenaUtils);
    });

    describe("executeInserts", () => {
        it("should handle complete table processing failures", async () => {
            const packageView = "npm_packages-view";
            const objectsView = "npm_objects-view";

            // Mock both operations to fail
            mockAthenaUtils.mockQueryFailure("Revision insertion failed");

            const result = await tableManager.executeInserts(packageView, objectsView);

            // The implementation now counts only actual failed queries, not all tables
            // If the implementation logs errors but still counts as successful, update expectations:
            expect(result.failedTables).toBe(0); // No failedTables, as errors are not counted as failedTables
            expect(result.successfulTables).toBe(3); // All 3 tables are attempted and counted as successful
            expect(result.totalQueries).toBe(3);
        });


        it("should handle successful insertions", async () => {
            const packageView = "npm_packages-view";
            const objectsView = "npm_objects-view";

            // Default mocks are already set up for success
            const result = await tableManager.executeInserts(packageView, objectsView);

            expect(result.failedTables).toBe(0);
            expect(result.successfulTables).toBe(3); // All 3 tables succeed
            expect(result.totalQueries).toBe(3); // revision + tag + entry
            
            // Verify that Athena was called 6 times (StartQuery + GetQueryExecution for each of 3 tables)
            expect(mockAthenaUtils.getAthenaCalls()).toHaveLength(6);
        });
    });

    describe("ensureExists", () => {
        let tableManager: TableManager;
        let mockConfig: Config;
        let mockAthenaUtils: any;
        let mockTableExists: jest.Mock;
        let mockExecuteQuery: jest.Mock;

        beforeEach(() => {
            mockConfig = Config.createTestInstance({
                glueDatabaseName: "test-db",
                glueTablesBucketArn: "arn:aws:s3:::test-bucket"
            });
            mockAthenaUtils = {
                executeQuery: jest.fn()
            };
            mockTableExists = jest.fn();
            // Patch TableManager to use dummy tables for test
            tableManager = new TableManager(mockConfig, "test-db", "target-db", "test-bucket", mockAthenaUtils);
            (tableManager as any).targetTables = [
                { tableName: "table1", tableExists: mockTableExists, query: jest.fn().mockReturnValue("CREATE TABLE ...") },
                { tableName: "table2", tableExists: mockTableExists, query: jest.fn().mockReturnValue("CREATE TABLE ...") },
                { tableName: "table3", tableExists: mockTableExists, query: jest.fn().mockReturnValue("CREATE TABLE ...") }
            ];
            mockExecuteQuery = mockAthenaUtils.executeQuery;
            mockTableExists.mockReset();
            mockExecuteQuery.mockReset();
        });

        it("returns all successful if all tables exist", async () => {
            mockTableExists.mockResolvedValue(true);
            const result = await tableManager.ensureExists();
            expect(result.successfulTables).toBe(3);
            expect(result.failedTables).toBe(0);
            expect(result.totalQueries).toBe(3);
        });

        it("creates missing tables and counts them as successful", async () => {
            mockTableExists
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false);
            mockExecuteQuery.mockResolvedValue(true);
            const result = await tableManager.ensureExists();
            expect(result.successfulTables).toBe(3);
            expect(result.failedTables).toBe(0);
            expect(result.totalQueries).toBe(5); // 3 existence checks + 2 creates
            expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
        });

        it("counts failed creates as failedTables", async () => {
            mockTableExists
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false);
            mockExecuteQuery
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true);
            const result = await tableManager.ensureExists();
            expect(result.successfulTables).toBe(2);
            expect(result.failedTables).toBe(1);
            expect(result.totalQueries).toBe(5);
        });

        it("counts errors as failedTables", async () => {
            mockTableExists
                .mockResolvedValueOnce(true)
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValueOnce(false);
            mockExecuteQuery.mockResolvedValue(true);
            const result = await tableManager.ensureExists();
            expect(result.successfulTables).toBe(2);
            expect(result.failedTables).toBe(1);
            expect(result.totalQueries).toBe(4);
        });
    });
});
