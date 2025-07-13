import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { createTableTestSetup } from "../shared/test-utils";
import { BaseTable } from "./base-table";
import { Config } from "../shared/config";
import { ColumnDefinitions } from "../shared/types";

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

    describe("BaseTable error handling", () => {
        // Create a concrete test implementation of BaseTable for testing
        class TestTable extends BaseTable {
            public get tableName(): string {
                return "test_table";
            }

            protected getColumnDefinitions(): ColumnDefinitions {
                return { id: "bigint", name: "varchar(255)" };
            }

            protected getPartitioningClause(): string {
                return "PARTITIONED BY (year)";
            }

            protected generateInsertQuery(packagesView: string, _objectsView: string): string {
                return `INSERT INTO ${this.tableName} SELECT * FROM ${packagesView}`;
            }

            protected generateSelectClause(_registryName: string, sourceAlias: string): string {
                return `${sourceAlias}.id, ${sourceAlias}.name`;
            }

            protected generateWhereClauseForCtas(sourceAlias: string): string {
                return `${sourceAlias}.id > 0`;
            }
        }

        // Test implementation with no column definitions
        class EmptyColumnsTable extends BaseTable {
            public get tableName(): string {
                return "empty_table";
            }

            protected getColumnDefinitions(): ColumnDefinitions {
                return {};
            }

            protected getPartitioningClause(): string {
                return "";
            }

            protected generateInsertQuery(packagesView: string, _objectsView: string): string {
                return `INSERT INTO ${this.tableName} SELECT * FROM ${packagesView}`;
            }

            protected generateSelectClause(_registryName: string, _sourceAlias: string): string {
                return "";
            }

            protected generateWhereClauseForCtas(_sourceAlias: string): string {
                return "";
            }
        }

        // Test implementation with invalid column definitions
        class InvalidColumnsTable extends BaseTable {
            public get tableName(): string {
                return "invalid_table";
            }

            protected getColumnDefinitions(): ColumnDefinitions {
                return { "": "bigint", "name": "" };
            }

            protected getPartitioningClause(): string {
                return "";
            }

            protected generateInsertQuery(packagesView: string, _objectsView: string): string {
                return `INSERT INTO ${this.tableName} SELECT * FROM ${packagesView}`;
            }

            protected generateSelectClause(_registryName: string, _sourceAlias: string): string {
                return "";
            }

            protected generateWhereClauseForCtas(_sourceAlias: string): string {
                return "";
            }
        }

        describe("generateColumnList", () => {
            it("should throw error when pattern is empty", () => {
                const table = new TestTable(testSetup.mockConfig);
                expect(() => table['generateColumnList']("")).toThrow("Pattern cannot be empty");
            });

            it("should throw error when pattern is only whitespace", () => {
                const table = new TestTable(testSetup.mockConfig);
                expect(() => table['generateColumnList']("   ")).toThrow("Pattern cannot be empty");
            });

            it("should throw error when no column definitions found", () => {
                const table = new EmptyColumnsTable(testSetup.mockConfig);
                expect(() => table['generateColumnList']("${name} ${type}")).toThrow("No column definitions found");
            });

            it("should throw error when column definitions are invalid", () => {
                const table = new InvalidColumnsTable(testSetup.mockConfig);
                expect(() => table['generateColumnList']("${name} ${type}")).toThrow("Invalid column definition");
            });
        });

        describe("generateCreateQuery", () => {
            it("should throw error when target bucket is missing for Glue table creation", () => {
                // Create a config with missing target bucket
                const configWithoutBucket = Config.createTestInstance({
                    glueDatabaseName: "test-db",
                    glueTablesBucketArn: ""
                });
                
                const table = new TestTable(configWithoutBucket);
                expect(() => table.generateCreateQuery()).toThrow("Target bucket is required for Glue table creation");
            });
        });

        describe("query method", () => {
            it("should throw error for unsupported query type", () => {
                const table = new TestTable(testSetup.mockConfig);
                expect(() => table.query('unknown' as any)).toThrow("Unsupported query type: unknown");
            });

            it("should throw error for insert query without required views", () => {
                const table = new TestTable(testSetup.mockConfig);
                expect(() => table.query('insert')).toThrow("At least one of packagesView or objectsView is required for insert queries");
            });
        });
    });
});
