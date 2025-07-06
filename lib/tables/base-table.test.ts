import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { createTableTestSetup } from "../shared/test-utils";

/**
 * Consolidated test suite for all package-related tables.
 * This file replaces the individual test files for package-revision, package-tag, and package-entry tables.
 */

describe("Package Tables", () => {
    let testSetup: ReturnType<typeof createTableTestSetup>;

    beforeEach(() => {
        testSetup = createTableTestSetup();
    });

    describe("PackageRevisionTable", () => {
        it("should have correct table name", () => {
            const table = new PackageRevisionTable(testSetup.mockConfig);
            expect(table.tableName).toBe("package_revision");
        });

        it("should generate insert query with correct WHERE clause", () => {
            const table = new PackageRevisionTable(testSetup.mockConfig);
            const query = table.generateInsertQuery("test_packages-view", "test_objects-view");
            expect(query).toContain("s.timestamp != 'latest'");
        });
    });

    describe("PackageTagTable", () => {
        it("should have correct table name", () => {
            const table = new PackageTagTable(testSetup.mockConfig);
            expect(table.tableName).toBe("package_tag");
        });

        it("should generate insert query with correct WHERE clause", () => {
            const table = new PackageTagTable(testSetup.mockConfig);
            const query = table.generateInsertQuery("test_packages-view", "test_objects-view");
            expect(query).toContain("s.timestamp = 'latest'");
        });
    });

    describe("PackageEntryTable", () => {
        it("should have correct table name", () => {
            const table = new PackageEntryTable(testSetup.mockConfig);
            expect(table.tableName).toBe("package_entry");
        });

        it("should generate insert query", () => {
            const table = new PackageEntryTable(testSetup.mockConfig);
            const query = table.generateInsertQuery("test_packages-view", "test_objects-view");
            expect(query).toBeTruthy();
            expect(query).toContain("INSERT INTO package_entry");
        });
    });

    describe("BaseTable tableExists method", () => {
        let testSetup: ReturnType<typeof createTableTestSetup>;
        let table: PackageRevisionTable;
        let mockAthenaUtils: any;

        beforeEach(() => {
            testSetup = createTableTestSetup();
            table = new PackageRevisionTable(testSetup.mockConfig);
            mockAthenaUtils = {
                executeQuery: jest.fn()
            };
        });

        describe("tableExists", () => {
            it("should return true when query succeeds and returns rows", async () => {
                mockAthenaUtils.executeQuery.mockResolvedValue({
                    success: true,
                    rowsReturned: 1,
                    queryId: "test-query-id"
                });

                const result = await table.tableExists(mockAthenaUtils);
                
                expect(result).toBe(true);
                expect(mockAthenaUtils.executeQuery).toHaveBeenCalledWith(
                    expect.stringContaining("SELECT table_name FROM information_schema.tables")
                );
            });

            it("should return false when query succeeds but returns no rows", async () => {
                mockAthenaUtils.executeQuery.mockResolvedValue({
                    success: true,
                    rowsReturned: 0,
                    queryId: "test-query-id"
                });

                const result = await table.tableExists(mockAthenaUtils);
                
                expect(result).toBe(false);
            });

            it("should return false when query fails", async () => {
                mockAthenaUtils.executeQuery.mockResolvedValue({
                    success: false,
                    rowsReturned: 0,
                    error: "Table not found"
                });

                const result = await table.tableExists(mockAthenaUtils);
                
                expect(result).toBe(false);
            });

            it("should return false when executeQuery throws 'not found' error", async () => {
                mockAthenaUtils.executeQuery.mockRejectedValue(new Error("Table does not exist"));

                const result = await table.tableExists(mockAthenaUtils);
                
                expect(result).toBe(false);
            });

            it("should throw error when executeQuery throws non-'not found' error", async () => {
                mockAthenaUtils.executeQuery.mockRejectedValue(new Error("Access denied"));

                await expect(table.tableExists(mockAthenaUtils)).rejects.toThrow("Access denied");
            });

            it("should use correct database name and table name in query", async () => {
                mockAthenaUtils.executeQuery.mockResolvedValue({
                    success: true,
                    rowsReturned: 1
                });

                await table.tableExists(mockAthenaUtils);
                
                const call = mockAthenaUtils.executeQuery.mock.calls[0][0];
                expect(call).toContain("table_schema = 'test-db'");
                expect(call).toContain("table_name = 'package_revision'");
            });
        });
    });
});
