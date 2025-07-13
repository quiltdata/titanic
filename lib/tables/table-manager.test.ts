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

            // All 3 queries should fail due to the mock error
            expect(result.failedTables).toBe(3);
            expect(result.successfulTables).toBe(0);
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

        it("should handle exceptions during query execution", async () => {
            const packageView = "npm_packages-view";
            const objectsView = "npm_objects-view";

            // Mock executeQuery to throw an exception
            mockAthenaUtils.mockQueryFailure("Network error");

            const result = await tableManager.executeInserts(packageView, objectsView);

            expect(result.failedTables).toBe(3);
            expect(result.successfulTables).toBe(0);
            expect(result.totalQueries).toBe(3);
        });

        it("should handle exceptions during table query generation", async () => {
            const packageView = "npm_packages-view";
            const objectsView = "npm_objects-view";

            // Mock the table's query method to throw an exception
            const originalTargetTables = (tableManager as any).targetTables;
            (tableManager as any).targetTables = [
                {
                    tableName: "test-table",
                    query: jest.fn().mockImplementation(() => {
                        throw new Error("Query generation failed");
                    })
                }
            ];

            const result = await tableManager.executeInserts(packageView, objectsView);

            expect(result.failedTables).toBe(1);
            expect(result.successfulTables).toBe(0);
            expect(result.totalQueries).toBe(1);

            // Restore original tables
            (tableManager as any).targetTables = originalTargetTables;
        });
    });

    describe("createTables", () => {
        it("should create tables successfully", async () => {
            // Default mocks are already set up for success
            const result = await tableManager.createTables();

            expect(result.failedTables).toBe(0);
            expect(result.successfulTables).toBe(3);
            expect(result.totalQueries).toBe(3);
        });

        it("should handle table already exists errors gracefully", async () => {
            // Mock one table creation to fail with "already exists" error
            mockAthenaUtils.mockQueryFailure("Table already exists");

            const result = await tableManager.createTables();

            // Should still count as successful due to graceful handling
            expect(result.failedTables).toBe(0);
            expect(result.successfulTables).toBe(3);
            expect(result.totalQueries).toBe(3);
        });

        it("should count failed creates as failedTables", async () => {
            // Mock table creation to fail with real error
            mockAthenaUtils.mockQueryFailure("Real create error");

            const result = await tableManager.createTables();

            expect(result.failedTables).toBe(3);
            expect(result.successfulTables).toBe(0);
            expect(result.totalQueries).toBe(3);
        });
    });

    describe("executeDrops", () => {
        it("should drop tables successfully", async () => {
            // Default mocks are already set up for success
            const result = await tableManager.executeDrops();

            expect(result.failedTables).toBe(0);
            expect(result.successfulTables).toBe(3);
            expect(result.totalQueries).toBe(3);
        });
    });

    describe("isS3AccessError", () => {
        it("should identify S3 access errors", () => {
            // Test each S3 error pattern
            expect((tableManager as any).isS3AccessError(new Error("access denied"))).toBe(true);
            expect((tableManager as any).isS3AccessError(new Error("AccessDenied"))).toBe(true);
            expect((tableManager as any).isS3AccessError(new Error("no such bucket"))).toBe(true);
            expect((tableManager as any).isS3AccessError(new Error("forbidden"))).toBe(true);
            expect((tableManager as any).isS3AccessError(new Error("403"))).toBe(true);
            expect((tableManager as any).isS3AccessError(new Error("bucket does not exist"))).toBe(true);
            
            // Test non-S3 errors
            expect((tableManager as any).isS3AccessError(new Error("Network error"))).toBe(false);
            expect((tableManager as any).isS3AccessError(new Error("Some other error"))).toBe(false);
        });
    });
});
