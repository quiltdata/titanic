import { Table } from "@aws-sdk/client-glue";
import { TableManager } from "./table-manager";
import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { Config } from "../shared/config";

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

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfig = Config.createTestInstance({
            glueDatabaseName: "test-db",
            glueTablesBucket: "test-bucket"
        });
        tableManager = new TableManager(mockConfig, "test-db", "target-db", "test-bucket");
    });

    describe("ensureTablesExist", () => {
        it("should create revision and tag tables when packages view exists", async () => {
            const tableManager = new TableManager(mockConfig, "test-db", "target-db", "test-bucket");
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
            const s3TableManager = new TableManager(mockConfig, "test-db", "target-db", "test-bucket");
            const sourceTables: Table[] = [
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockResolvedValue();

            const result = await s3TableManager.ensureTablesExist(sourceTables);

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
