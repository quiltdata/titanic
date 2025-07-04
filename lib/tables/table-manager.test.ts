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

            expect(result.failedTables).toBe(3); // All 3 tables fail
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
    });
});
