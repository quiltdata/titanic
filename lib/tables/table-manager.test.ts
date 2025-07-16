import { TableManager } from "./table-manager";
import { Config } from "../shared/config";
import { AthenaTest } from "../shared/athena-test";

describe("TableManager", () => {
    let tableManager: TableManager;
    let mockConfig: Config;
    let mockAthenaUtils: AthenaTest;

    beforeEach(() => {
        mockConfig = Config.createTestInstance({
            athenaDatabaseName: "test-db",
            glueTablesBucketName: "test-bucket"
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

        describe("S3 Tables mode", () => {
            beforeEach(() => {
                // Configure for S3 Tables mode
                mockConfig = Config.createTestInstance({
                    athenaDatabaseName: "test-db",
                    useS3Table: true,
                    glueTablesBucketName: "test-bucket"
                });
                mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);
                tableManager = TableManager.createTestInstance(mockConfig, "test-db", "target-db", "test-bucket", mockAthenaUtils);
            });

            it("should skip table creation and validate S3 Tables exist", async () => {
                // Mock table existence queries to succeed (default is already success)
                // Reset mocks to ensure clean state
                mockAthenaUtils.resetMocks();

                const result = await tableManager.createTables();

                expect(result.failedTables).toBe(0);
                expect(result.successfulTables).toBe(3); // All tables found
                expect(result.totalQueries).toBe(3); // Only table existence checks, no table creation
            });

            it("should throw error when required S3 Tables are missing", async () => {
                // Mock table existence queries to fail (tables don't exist)
                mockAthenaUtils.mockQueryFailure("Table 'package_revision' doesn't exist");

                await expect(tableManager.createTables()).rejects.toThrow(
                    "Required S3 Tables not found: package_revision, package_tag, package_entry. Please create them using 'npm run s3tables:create' before running this operation."
                );
            });

            it("should handle mixed table existence results", async () => {
                // Mock first table to exist, others to fail
                let queryCallCount = 0;
                const originalExecuteQuery = mockAthenaUtils.executeQuery;
                mockAthenaUtils.executeQuery = jest.fn().mockImplementation(async (query: string) => {
                    queryCallCount++;
                    
                    // Database creation calls
                    if (query.includes('CREATE DATABASE')) {
                        return { success: true, data: [] };
                    }
                    
                    // Table existence check calls
                    if (query.includes('SELECT COUNT(*)')) {
                        if (query.includes('package_revision')) {
                            // First table exists
                            return { success: true, data: [] };
                        } else {
                            // package_tag and package_entry don't exist
                            throw new Error("Table doesn't exist");
                        }
                    }
                    
                    return { success: true, data: [] };
                });

                await expect(tableManager.createTables()).rejects.toThrow(
                    "Required S3 Tables not found: package_tag, package_entry"
                );

                // Restore original mock
                mockAthenaUtils.executeQuery = originalExecuteQuery;
            });
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

    describe("Constants", () => {
        it("should use correct namespace from config", () => {
            // Test that config provides the correct namespace
            expect(mockConfig.getNamespace()).toBe('s3tablesbucket.preview');
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

    describe("isTableAlreadyExistsError", () => {
        it("should identify table already exists errors", () => {
            // Test various table already exists error patterns
            expect((tableManager as any).isTableAlreadyExistsError("table already exists")).toBe(true);
            expect((tableManager as any).isTableAlreadyExistsError("Table already exists")).toBe(true);
            expect((tableManager as any).isTableAlreadyExistsError("already exists")).toBe(true);
            expect((tableManager as any).isTableAlreadyExistsError("duplicate table")).toBe(true);
            expect((tableManager as any).isTableAlreadyExistsError("table_already_exists")).toBe(true);
            
            // Test non-table-exists errors
            expect((tableManager as any).isTableAlreadyExistsError("Network error")).toBe(false);
            expect((tableManager as any).isTableAlreadyExistsError("Some other error")).toBe(false);
            expect((tableManager as any).isTableAlreadyExistsError(undefined)).toBe(false);
            expect((tableManager as any).isTableAlreadyExistsError("")).toBe(false);
        });
    });

    describe("testTableExistence", () => {
        it("should identify all existing tables", async () => {
            // Default mocks already set up for success
            const result = await tableManager.testTableExistence();

            expect(result.existingTables).toEqual(["package_revision", "package_tag", "package_entry"]);
            expect(result.missingTables).toEqual([]);
            expect(result.totalQueries).toBe(3);
        });

        it("should identify all missing tables when queries fail", async () => {
            // Mock all queries to fail
            mockAthenaUtils.mockQueryFailure("Table doesn't exist");

            const result = await tableManager.testTableExistence();

            expect(result.existingTables).toEqual([]);
            expect(result.missingTables).toEqual(["package_revision", "package_tag", "package_entry"]);
            expect(result.totalQueries).toBe(3);
        });

        it("should handle mixed table existence results from executeQuery results", async () => {
            // Mock first table to exist (success=true), others to fail (success=false)
            let callCount = 0;
            const originalExecuteQuery = mockAthenaUtils.executeQuery;
            mockAthenaUtils.executeQuery = jest.fn().mockImplementation(async (query: string) => {
                callCount++;
                if (callCount === 1) {
                    return { success: true, data: [] };
                }
                return { success: false, error: "Table doesn't exist" };
            });

            const result = await tableManager.testTableExistence();

            expect(result.existingTables).toEqual(["package_revision"]);
            expect(result.missingTables).toEqual(["package_tag", "package_entry"]);
            expect(result.totalQueries).toBe(3);

            // Restore original mock
            mockAthenaUtils.executeQuery = originalExecuteQuery;
        });

        it("should handle exceptions during table existence checks", async () => {
            // Mock some queries to throw exceptions
            let callCount = 0;
            const originalExecuteQuery = mockAthenaUtils.executeQuery;
            mockAthenaUtils.executeQuery = jest.fn().mockImplementation(async (query: string) => {
                callCount++;
                if (callCount === 1) {
                    return { success: true, data: [] };
                }
                if (callCount === 2) {
                    throw new Error("Network timeout");
                }
                return { success: false, error: "Table doesn't exist" };
            });

            const result = await tableManager.testTableExistence();

            expect(result.existingTables).toEqual(["package_revision"]);
            expect(result.missingTables).toEqual(["package_tag", "package_entry"]);
            expect(result.totalQueries).toBe(3);

            // Restore original mock
            mockAthenaUtils.executeQuery = originalExecuteQuery;
        });

        describe("S3 Tables mode", () => {
            beforeEach(() => {
                // Configure for S3 Tables mode
                mockConfig = Config.createTestInstance({
                    athenaDatabaseName: "test-db",
                    useS3Table: true,
                    glueTablesBucketName: "test-bucket"
                });
                mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);
                tableManager = TableManager.createTestInstance(mockConfig, "test-db", "target-db", "test-bucket", mockAthenaUtils);
            });

            it("should use fully-qualified table names in existence checks", async () => {
                const result = await tableManager.testTableExistence();

                // Verify that queries used fully-qualified names
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                const startQueryCalls = athenaCalls.filter(call => call.firstArg?.input?.QueryString);
                
                // Should have 3 SELECT COUNT(*) queries with fully-qualified names
                expect(startQueryCalls.length).toBe(3);
                expect(startQueryCalls[0]?.firstArg?.input?.QueryString).toContain("preview.package_revision");
                expect(startQueryCalls[1]?.firstArg?.input?.QueryString).toContain("preview.package_tag");
                expect(startQueryCalls[2]?.firstArg?.input?.QueryString).toContain("preview.package_entry");

                expect(result.existingTables).toEqual(["package_revision", "package_tag", "package_entry"]);
                expect(result.missingTables).toEqual([]);
                expect(result.totalQueries).toBe(3);
            });
        });
    });

    describe("createDatabaseIfNeeded", () => {
        describe("S3 Tables mode", () => {
            beforeEach(() => {
                // Configure for S3 Tables mode with different source and target databases
                mockConfig = Config.createTestInstance({
                    athenaDatabaseName: "source-db",
                    useS3Table: true,
                    glueTablesBucketName: "test-bucket"
                });
                mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);
                tableManager = TableManager.createTestInstance(mockConfig, "source-db", "target-db", "test-bucket", mockAthenaUtils);
            });

            it("should create database and log namespace instruction when target database differs from source in S3 Tables mode", async () => {
                // Execute the method
                await tableManager.createDatabaseIfNeeded();

                // Verify that only CREATE DATABASE query was executed (no namespace creation)
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(2); // StartQuery + GetQueryExecution for database only
                
                // Check that the query was for creating the target database only
                const startQueryCalls = athenaCalls.filter(call => call.firstArg?.input?.QueryString);
                expect(startQueryCalls).toHaveLength(1);
                
                expect(startQueryCalls[0]?.firstArg?.input?.QueryString).toBe("CREATE DATABASE IF NOT EXISTS target-db");
                // No namespace creation query should be present
            });

            it("should handle database creation and continue with namespace instruction", async () => {
                // Database creation succeeds, and we just log namespace instruction
                await tableManager.createDatabaseIfNeeded();

                // Verify that only database creation was attempted
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(2); // StartQuery + GetQueryExecution for database only
                
                // Check that only database creation query was executed
                const startQueryCalls = athenaCalls.filter(call => call.firstArg?.input?.QueryString);
                expect(startQueryCalls).toHaveLength(1);
                expect(startQueryCalls[0]?.firstArg?.input?.QueryString).toBe("CREATE DATABASE IF NOT EXISTS target-db");
            });

            it("should not create database when database creation fails", async () => {
                // Mock database creation to fail
                mockAthenaUtils.mockQueryFailure("Database creation failed");

                await tableManager.createDatabaseIfNeeded();

                // Verify that only database creation was attempted (no namespace creation)
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(1); // Only StartQuery for database since it fails
            });

            it("should not create database when target database is same as source in S3 Tables mode", async () => {
                // Set up table manager with same source and target database
                tableManager = TableManager.createTestInstance(mockConfig, "same-db", "same-db", "test-bucket", mockAthenaUtils);

                await tableManager.createDatabaseIfNeeded();

                // Verify no Athena calls were made
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(0);
            });

            it("should handle database creation failure gracefully", async () => {
                // Mock database creation to fail
                mockAthenaUtils.mockQueryFailure("Permission denied");

                // Should not throw an error
                await expect(tableManager.createDatabaseIfNeeded()).resolves.not.toThrow();

                // Verify that the query was attempted (only StartQuery call, no GetQueryExecution since it fails)
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(1); // Only StartQuery since it throws
            });

            it("should handle database creation success with namespace instruction", async () => {
                // Default mock setup already handles success
                await tableManager.createDatabaseIfNeeded();

                // Verify that only database query was executed successfully (no namespace SQL)
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(2); // StartQuery + GetQueryExecution for database only
                
                const startQueryCalls = athenaCalls.filter(call => call.firstArg?.input?.QueryString);
                expect(startQueryCalls).toHaveLength(1);
                expect(startQueryCalls[0]?.firstArg?.input?.QueryString).toBe("CREATE DATABASE IF NOT EXISTS target-db");
                // Namespace creation should be handled via AWS CLI, not SQL
            });
        });

        describe("Glue Tables mode", () => {
            beforeEach(() => {
                // Configure for Glue Tables mode (useS3Table = false)
                mockConfig = Config.createTestInstance({
                    athenaDatabaseName: "test-db",
                    useS3Table: false,
                    glueTablesBucketName: "test-bucket"
                });
                mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);
                tableManager = TableManager.createTestInstance(mockConfig, "test-db", "target-db", "test-bucket", mockAthenaUtils);
            });

            it("should not create database in Glue Tables mode even with different target database", async () => {
                await tableManager.createDatabaseIfNeeded();

                // Verify no Athena calls were made since it's Glue Tables mode
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(0);
            });
        });

        describe("Edge cases", () => {
            it("should handle undefined useS3Table config gracefully", async () => {
                // Create config without explicitly setting useS3Table
                mockConfig = Config.createTestInstance({
                    athenaDatabaseName: "test-db",
                    glueTablesBucketName: "test-bucket"
                });
                mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);
                tableManager = TableManager.createTestInstance(mockConfig, "test-db", "target-db", "test-bucket", mockAthenaUtils);

                await tableManager.createDatabaseIfNeeded();

                // Should default to Glue mode (no database creation)
                const athenaCalls = mockAthenaUtils.getAthenaCalls();
                expect(athenaCalls).toHaveLength(0);
            });
        });
    });
});
