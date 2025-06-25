import { Table } from "@aws-sdk/client-glue";
import { TableManager } from "./table-manager";
import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";

// Mock all table classes
jest.mock("./package-revision");
jest.mock("./package-tag");
jest.mock("./package-entry");

const MockedPackageRevisionTable = jest.mocked(PackageRevisionTable);
const MockedPackageTagTable = jest.mocked(PackageTagTable);
const MockedPackageEntryTable = jest.mocked(PackageEntryTable);

describe("TableManager", () => {
    let tableManager: TableManager;

    beforeEach(() => {
        jest.clearAllMocks();
        tableManager = new TableManager("test-db", "test-bucket");
    });

    describe("ensureTablesExist", () => {
        it("should create revision and tag tables when packages view exists", async () => {
            const sourceTables: Table[] = [
                { Name: "test_packages-view" },
                { Name: "other_table" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockResolvedValue();

            await tableManager.ensureTablesExist(sourceTables);

            expect(MockedPackageRevisionTable.ensureExists).toHaveBeenCalledWith(
                "test-db", 
                "test-bucket", 
                "test_packages-view",
                false
            );
            expect(MockedPackageTagTable.ensureExists).toHaveBeenCalledWith(
                "test-db", 
                "test-bucket", 
                "test_packages-view",
                false
            );
            expect(MockedPackageEntryTable.ensureExists).not.toHaveBeenCalled();
        });

        it("should pass useS3Table=true when configured", async () => {
            const s3TableManager = new TableManager("test-db", "test-bucket", true);
            const sourceTables: Table[] = [
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockResolvedValue();

            await s3TableManager.ensureTablesExist(sourceTables);

            expect(MockedPackageRevisionTable.ensureExists).toHaveBeenCalledWith(
                "test-db", 
                "test-bucket", 
                "test_packages-view",
                true
            );
            expect(MockedPackageTagTable.ensureExists).toHaveBeenCalledWith(
                "test-db", 
                "test-bucket", 
                "test_packages-view",
                true
            );
        });

        it("should create entry table when objects view exists", async () => {
            const sourceTables: Table[] = [
                { Name: "test_objects-view" },
                { Name: "other_table" }
            ];

            MockedPackageEntryTable.ensureExists.mockResolvedValue();

            await tableManager.ensureTablesExist(sourceTables);

            expect(MockedPackageEntryTable.ensureExists).toHaveBeenCalledWith(
                "test-db", 
                "test-bucket", 
                "test_objects-view",
                false
            );
            expect(MockedPackageRevisionTable.ensureExists).not.toHaveBeenCalled();
            expect(MockedPackageTagTable.ensureExists).not.toHaveBeenCalled();
        });

        it("should create all tables when both view types exist", async () => {
            const sourceTables: Table[] = [
                { Name: "test_packages-view" },
                { Name: "test_objects-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockResolvedValue();
            MockedPackageEntryTable.ensureExists.mockResolvedValue();

            await tableManager.ensureTablesExist(sourceTables);

            expect(MockedPackageRevisionTable.ensureExists).toHaveBeenCalled();
            expect(MockedPackageTagTable.ensureExists).toHaveBeenCalled();
            expect(MockedPackageEntryTable.ensureExists).toHaveBeenCalled();
        });

        it("should handle tables without names", async () => {
            const sourceTables: Table[] = [
                { Name: undefined },
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.ensureExists.mockResolvedValue();
            MockedPackageTagTable.ensureExists.mockResolvedValue();

            await tableManager.ensureTablesExist(sourceTables);

            expect(MockedPackageRevisionTable.ensureExists).toHaveBeenCalledTimes(1);
            expect(MockedPackageTagTable.ensureExists).toHaveBeenCalledTimes(1);
        });
    });

    describe("executeInserts", () => {
        it("should execute inserts for packages view", async () => {
            const sourceTables: Table[] = [
                { Name: "test_bucket_packages-view" }
            ];

            MockedPackageRevisionTable.insert.mockResolvedValue();
            MockedPackageTagTable.insert.mockResolvedValue();

            const queryCount = await tableManager.executeInserts(sourceTables);

            expect(queryCount).toBe(2);
            expect(MockedPackageRevisionTable.insert).toHaveBeenCalledWith(
                {
                    databaseName: "test-db",
                    targetBucket: "test-bucket",
                    registryName: "test_bucket",
                    useS3Table: false
                },
                "test_bucket_packages-view"
            );
            expect(MockedPackageTagTable.insert).toHaveBeenCalledWith(
                {
                    databaseName: "test-db",
                    targetBucket: "test-bucket",
                    registryName: "test_bucket",
                    useS3Table: false
                },
                "test_bucket_packages-view"
            );
        });

        it("should pass useS3Table=true in context when configured", async () => {
            const s3TableManager = new TableManager("test-db", "test-bucket", true);
            const sourceTables: Table[] = [
                { Name: "test_bucket_packages-view" }
            ];

            MockedPackageRevisionTable.insert.mockResolvedValue();
            MockedPackageTagTable.insert.mockResolvedValue();

            const queryCount = await s3TableManager.executeInserts(sourceTables);

            expect(queryCount).toBe(2);
            expect(MockedPackageRevisionTable.insert).toHaveBeenCalledWith(
                {
                    databaseName: "test-db",
                    targetBucket: "test-bucket",
                    registryName: "test_bucket",
                    useS3Table: true
                },
                "test_bucket_packages-view"
            );
            expect(MockedPackageTagTable.insert).toHaveBeenCalledWith(
                {
                    databaseName: "test-db",
                    targetBucket: "test-bucket",
                    registryName: "test_bucket",
                    useS3Table: true
                },
                "test_bucket_packages-view"
            );
        });

        it("should execute inserts for objects view", async () => {
            const sourceTables: Table[] = [
                { Name: "prod_registry_objects-view" }
            ];

            MockedPackageEntryTable.insert.mockResolvedValue();

            const queryCount = await tableManager.executeInserts(sourceTables);

            expect(queryCount).toBe(1);
            expect(MockedPackageEntryTable.insert).toHaveBeenCalledWith(
                {
                    databaseName: "test-db",
                    targetBucket: "test-bucket",
                    registryName: "prod_registry",
                    useS3Table: false
                },
                "prod_registry_objects-view"
            );
        });

        it("should handle mixed table types", async () => {
            const sourceTables: Table[] = [
                { Name: "bucket1_packages-view" },
                { Name: "bucket2_objects-view" },
                { Name: "bucket3_packages-view" }
            ];

            MockedPackageRevisionTable.insert.mockResolvedValue();
            MockedPackageTagTable.insert.mockResolvedValue();
            MockedPackageEntryTable.insert.mockResolvedValue();

            const queryCount = await tableManager.executeInserts(sourceTables);

            expect(queryCount).toBe(5); // 2 + 1 + 2 queries
            expect(MockedPackageRevisionTable.insert).toHaveBeenCalledTimes(2);
            expect(MockedPackageTagTable.insert).toHaveBeenCalledTimes(2);
            expect(MockedPackageEntryTable.insert).toHaveBeenCalledTimes(1);
        });

        it("should skip tables without names", async () => {
            const sourceTables: Table[] = [
                { Name: undefined },
                { Name: "test_packages-view" }
            ];

            MockedPackageRevisionTable.insert.mockResolvedValue();
            MockedPackageTagTable.insert.mockResolvedValue();

            const queryCount = await tableManager.executeInserts(sourceTables);

            expect(queryCount).toBe(2);
            expect(MockedPackageRevisionTable.insert).toHaveBeenCalledTimes(1);
            expect(MockedPackageTagTable.insert).toHaveBeenCalledTimes(1);
        });

        it("should ignore unrecognized table patterns", async () => {
            const sourceTables: Table[] = [
                { Name: "unknown_table" },
                { Name: "another_table" }
            ];

            const queryCount = await tableManager.executeInserts(sourceTables);

            expect(queryCount).toBe(0);
            expect(MockedPackageRevisionTable.insert).not.toHaveBeenCalled();
            expect(MockedPackageTagTable.insert).not.toHaveBeenCalled();
            expect(MockedPackageEntryTable.insert).not.toHaveBeenCalled();
        });
    });
});
