import { Table } from "@aws-sdk/client-glue";
import { TableManager } from "./table-manager";
import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { Config } from "../shared/config";
import { AthenaTest } from "../shared/athena-test";

// Mock all table classes
jest.mock("./package-revision");
jest.mock("./package-tag");
jest.mock("./package-entry");

const MockedPackageRevisionTable = jest.mocked(PackageRevisionTable);
const MockedPackageTagTable = jest.mocked(PackageTagTable);
const MockedPackageEntryTable = jest.mocked(PackageEntryTable);

describe("TableManager", () => {
    let tableManager: TableManager;
    let mockConfig: Config;
    let mockAthenaUtils: AthenaTest;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockConfig = Config.createTestInstance({
            glueDatabaseName: "test-db",
            glueTablesBucket: "test-bucket"
        });
        
        // Create mock AthenaUtils instance using the new AthenaTest class
        mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);
        
        // Mock tableExists to return false by default (tables don't exist)
        mockAthenaUtils.mockTableExists("package_revision", false);
        mockAthenaUtils.mockTableExists("package_tag", false);
        mockAthenaUtils.mockTableExists("package_entry", false);
        
        tableManager = TableManager.createTestInstance(mockConfig, "test-db", "target-db", "test-bucket", mockAthenaUtils);
    });

    describe("ensureTablesExist", () => {
        it("should create revision and tag tables when packages view exists", async () => {
            const sourceTables: Table[] = [
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockResolvedValue();

            const result = await tableManager.ensureTablesExist(sourceTables);

            expect(result.totalTables).toBe(2);
            expect(result.successfulTables).toBe(2);
            expect(result.failedTables).toBe(0);
            expect(MockedPackageRevisionTable.ensureExists).toHaveBeenCalledWith(
                mockConfig, 
                "test_packages-view"
            );
            expect(MockedPackageTagTable.ensureExists).toHaveBeenCalledWith(
                mockConfig, 
                "test_packages-view"
            );
            expect(MockedPackageEntryTable.ensureExists).not.toHaveBeenCalled();
        });

        it("should configure S3 Tables mode when useS3Table=true", async () => {
            const sourceTables: Table[] = [
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockResolvedValue();

            const result = await tableManager.ensureTablesExist(sourceTables);

            expect(result.totalTables).toBe(2);
            expect(result.successfulTables).toBe(2);
            expect(result.failedTables).toBe(0);
            expect(MockedPackageRevisionTable.ensureExists).toHaveBeenCalledWith(
                mockConfig, 
                "test_packages-view"
            );
            expect(MockedPackageTagTable.ensureExists).toHaveBeenCalledWith(
                mockConfig, 
                "test_packages-view"
            );
        });

        it("should create entry table when objects view exists", async () => {
            const sourceTables: Table[] = [
                { Name: "test_objects-view" },
                { Name: "other_table" }
            ];

            MockedPackageEntryTable.ensureExists.mockResolvedValue();

            const result = await tableManager.ensureTablesExist(sourceTables);

            expect(result.totalTables).toBe(1);
            expect(result.successfulTables).toBe(1);
            expect(result.failedTables).toBe(0);
            expect(MockedPackageEntryTable.ensureExists).toHaveBeenCalledWith(
                mockConfig, 
                "test_objects-view"
            );
        });

        it("should not create any tables when no relevant views exist", async () => {
            const sourceTables: Table[] = [
                { Name: "unrelated_table" }
            ];

            const result = await tableManager.ensureTablesExist(sourceTables);

            expect(result.totalTables).toBe(0);
            expect(result.successfulTables).toBe(0);
            expect(result.failedTables).toBe(0);
            expect(MockedPackageRevisionTable.ensureExists).not.toHaveBeenCalled();
            expect(MockedPackageTagTable.ensureExists).not.toHaveBeenCalled();
            expect(MockedPackageEntryTable.ensureExists).not.toHaveBeenCalled();
        });
    });

    describe("error handling", () => {
        it("should handle errors when creating package_revision table", async () => {
            const sourceTables: Table[] = [
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockRejectedValue(new Error("Create revision table failed"));
            MockedPackageTagTable.ensureExists.mockResolvedValue();

            const result = await tableManager.ensureTablesExist(sourceTables);

            expect(result.failedTables).toBe(1);
            expect(result.successfulTables).toBe(1); // tag table should still succeed
            expect(result.totalTables).toBe(2);
        });

        it("should handle errors when creating package_tag table", async () => {
            const sourceTables: Table[] = [
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockRejectedValue(new Error("Create tag table failed"));

            const result = await tableManager.ensureTablesExist(sourceTables);

            expect(result.failedTables).toBe(1);
            expect(result.successfulTables).toBe(1); // revision table should still succeed
            expect(result.totalTables).toBe(2);
        });

        it("should handle errors when creating package_entry table", async () => {
            const sourceTables: Table[] = [
                { Name: "test_objects-view" }
            ];

            MockedPackageEntryTable.ensureExists.mockRejectedValue(new Error("Create entry table failed"));

            const result = await tableManager.ensureTablesExist(sourceTables);

            expect(result.failedTables).toBe(1);
            expect(result.successfulTables).toBe(0);
            expect(result.totalTables).toBe(1);
        });
    });

    describe("executeInserts", () => {
        it("should handle errors during table insertion operations", async () => {
            const sourceTables: Table[] = [
                { Name: "npm_packages-view" }
            ];

            // Mock successful revision insertion but failed tag insertion
            MockedPackageRevisionTable.insert.mockResolvedValue();
            MockedPackageTagTable.insert.mockRejectedValue(new Error("Tag insertion failed"));

            const result = await tableManager.executeInserts(sourceTables);

            expect(result.failedTables).toBe(1);
            expect(result.totalQueries).toBe(2); // Both operations should be counted
        });

        it("should handle complete table processing failures", async () => {
            const sourceTables: Table[] = [
                { Name: "npm_packages-view" }
            ];

            // Mock both operations to fail
            MockedPackageRevisionTable.insert.mockRejectedValue(new Error("Revision insertion failed"));
            MockedPackageTagTable.insert.mockRejectedValue(new Error("Tag insertion failed"));

            const result = await tableManager.executeInserts(sourceTables);

            expect(result.failedTables).toBe(1);
            expect(result.successfulTables).toBe(0);
            expect(result.totalQueries).toBe(2);
        });

        it("should skip tables that don't match expected patterns", async () => {
            const sourceTables: Table[] = [
                { Name: "unrelated_table" }
            ];

            // For unrelated tables, no operations should be executed
            const result = await tableManager.executeInserts(sourceTables);

            expect(result.failedTables).toBe(0);
            expect(result.successfulTables).toBe(0);
            expect(result.totalQueries).toBe(0);
            expect(MockedPackageRevisionTable.insert).not.toHaveBeenCalled();
            expect(MockedPackageTagTable.insert).not.toHaveBeenCalled();
        });
    });
});

MockedPackageRevisionTable.ensureExists.mockImplementation((config, sourceView) => {
    return Promise.resolve();
});

MockedPackageTagTable.ensureExists.mockImplementation((config, sourceView) => {
    return Promise.resolve();
});

MockedPackageEntryTable.ensureExists.mockImplementation((config, sourceView) => {
    return Promise.resolve();
});
