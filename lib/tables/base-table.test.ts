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
});
