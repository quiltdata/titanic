import { S3TablesCreator } from "./create-s3-tables";
import { S3Config } from "../shared/config";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";

// Mock modules
jest.mock("child_process");
jest.mock("fs");
jest.mock("./package-revision");
jest.mock("./package-tag");
jest.mock("./package-entry");

describe("S3TablesCreator", () => {
    let creator: S3TablesCreator;
    let mockConfig: S3Config;
    let mockExecSync: jest.MockedFunction<typeof execSync>;
    let mockWriteFileSync: jest.MockedFunction<typeof writeFileSync>;
    let mockMkdirSync: jest.MockedFunction<typeof mkdirSync>;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
        mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
        mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
        
        mockConfig = S3Config.createTestInstance({
            awsAccountId: "123456789012",
            aws_region: "us-east-1",
            s3TablesBucketName: "test-bucket",
            namespace: "test"
        });
        creator = new S3TablesCreator(mockConfig);
    });

    describe("constructor", () => {
        it("should create instance with provided S3Config", () => {
            expect(creator).toBeDefined();
        });

        it("should create instance with default S3Config when none provided", () => {
            const defaultCreator = new S3TablesCreator();
            expect(defaultCreator).toBeDefined();
        });
    });

    describe("generateTableDefinition", () => {
        it("should generate valid table definition for PackageRevisionTable", () => {
            const mockTable = {
                tableName: "package_revision",
                getColumnDefinitions: () => ({
                    'registry': 'STRING',
                    'pkg_name': 'STRING',
                    'top_hash': 'STRING',
                    'timestamp': 'TIMESTAMP',
                    'message': 'STRING',
                    'metadata': 'STRING'
                }),
                getPartitioningClause: () => "PARTITIONED BY (registry, bucket(8, pkg_name), bucket(8, top_hash))"
            };

            const definition = creator['generateTableDefinition'](
                mockTable, 
                "arn:aws:s3tables:us-east-1:123456789012:bucket/test-bucket", 
                "test"
            );

            expect(definition).toEqual({
                tableBucketARN: "arn:aws:s3tables:us-east-1:123456789012:bucket/test-bucket",
                namespace: "test",
                name: "package_revision",
                format: "ICEBERG",
                metadata: {
                    iceberg: {
                        schema: {
                            fields: [
                                { name: "registry", type: "string", required: true },
                                { name: "pkg_name", type: "string", required: true },
                                { name: "top_hash", type: "string", required: true },
                                { name: "timestamp", type: "timestamp", required: false },
                                { name: "message", type: "string", required: false },
                                { name: "metadata", type: "string", required: false }
                            ]
                        },
                        partitionSpec: [
                            { sourceColumnId: "registry", fieldId: 1, transform: "identity" },
                            { sourceColumnId: "pkg_name", fieldId: 2, transform: "bucket", transformArgs: [8] },
                            { sourceColumnId: "top_hash", fieldId: 3, transform: "bucket", transformArgs: [8] }
                        ]
                    }
                }
            });
        });

        it("should handle table with no partitioning", () => {
            const mockTable = {
                tableName: "simple_table",
                getColumnDefinitions: () => ({
                    'id': 'STRING',
                    'name': 'STRING'
                }),
                getPartitioningClause: () => ""
            };

            const definition = creator['generateTableDefinition'](
                mockTable,
                "arn:aws:s3tables:us-east-1:123456789012:bucket/test-bucket",
                "test"
            );

            expect(definition.metadata.iceberg.partitionSpec).toBeUndefined();
        });
    });

    describe("checkPrerequisites", () => {
        it("should be a static method", () => {
            expect(typeof S3TablesCreator.checkPrerequisites).toBe('function');
        });

        it("should succeed when AWS CLI and s3tables commands are available", () => {
            mockExecSync.mockReturnValue("");
            
            expect(() => S3TablesCreator.checkPrerequisites()).not.toThrow();
            expect(mockExecSync).toHaveBeenCalledWith('aws --version', { stdio: 'ignore' });
            expect(mockExecSync).toHaveBeenCalledWith('aws s3tables help', { stdio: 'ignore' });
        });

        it("should throw error when AWS CLI is not available", () => {
            mockExecSync.mockImplementation((cmd) => {
                if (cmd === 'aws --version') {
                    throw new Error('Command not found');
                }
                return "";
            });

            expect(() => S3TablesCreator.checkPrerequisites()).toThrow(
                "AWS CLI is not installed or not in PATH. Please install AWS CLI to use S3 Tables functionality."
            );
        });

        it("should throw error when s3tables commands are not available", () => {
            mockExecSync.mockImplementation((cmd) => {
                if (cmd === 'aws s3tables help') {
                    throw new Error('Command not found');
                }
                return "";
            });

            expect(() => S3TablesCreator.checkPrerequisites()).toThrow(
                "AWS CLI s3tables commands are not available. Please update AWS CLI to a version that supports S3 Tables."
            );
        });
    });

    describe("createNamespace", () => {
        it("should create namespace successfully", async () => {
            mockExecSync.mockReturnValue("Namespace created");
            
            await creator.createNamespace();
            
            expect(mockExecSync).toHaveBeenCalledWith(
                `aws s3tables create-namespace --table-bucket-arn "arn:aws:s3tables:us-east-1:123456789012:bucket/titanic-s3-tables-123456789012-us-east-1" --namespace "test"`,
                { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }
            );
        });

        it("should handle namespace already exists error", async () => {
            const error = new Error("ConflictException: Namespace already exists");
            mockExecSync.mockImplementation(() => {
                throw error;
            });
            
            await expect(creator.createNamespace()).resolves.not.toThrow();
        });

        it("should throw other errors", async () => {
            const error = new Error("Some other error");
            mockExecSync.mockImplementation(() => {
                throw error;
            });
            
            await expect(creator.createNamespace()).rejects.toThrow("Some other error");
        });
    });

    describe("createTables", () => {
        beforeEach(() => {
            // Mock table classes
            (PackageRevisionTable as jest.Mock).mockImplementation(() => ({
                tableName: "package_revision",
                getColumnDefinitions: () => ({ registry: 'STRING', pkg_name: 'STRING' }),
                getPartitioningClause: () => "PARTITIONED BY (registry)"
            }));
            
            (PackageTagTable as jest.Mock).mockImplementation(() => ({
                tableName: "package_tag",
                getColumnDefinitions: () => ({ registry: 'STRING', tag_name: 'STRING' }),
                getPartitioningClause: () => "PARTITIONED BY (registry)"
            }));
            
            (PackageEntryTable as jest.Mock).mockImplementation(() => ({
                tableName: "package_entry",
                getColumnDefinitions: () => ({ registry: 'STRING', entry_path: 'STRING' }),
                getPartitioningClause: () => "PARTITIONED BY (registry)"
            }));
        });

        it("should create all tables successfully", async () => {
            mockExecSync.mockReturnValue("Success");
            
            await creator.createTables();
            
            // Should create namespace first
            expect(mockExecSync).toHaveBeenCalledWith(
                expect.stringContaining('create-namespace'),
                expect.any(Object)
            );
            
            // Should create directory
            expect(mockMkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('temp-s3-tables'),
                { recursive: true }
            );
            
            // Should create all three tables
            expect(mockExecSync).toHaveBeenCalledWith(
                expect.stringContaining('create-table'),
                expect.any(Object)
            );
            
            // Should write table definitions
            expect(mockWriteFileSync).toHaveBeenCalledTimes(3);
            
            // Should clean up
            expect(mockExecSync).toHaveBeenCalledWith(
                expect.stringContaining('rm -rf'),
                { stdio: 'ignore' }
            );
        });

        it("should handle table creation errors gracefully", async () => {
            mockExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('create-table')) {
                    throw new Error("ConflictException: Table already exists");
                }
                return "Success";
            });
            
            await expect(creator.createTables()).resolves.not.toThrow();
        });

        it("should clean up even if table creation fails", async () => {
            mockExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('create-table')) {
                    throw new Error("Some error");
                }
                return "Success";
            });
            
            await expect(creator.createTables()).rejects.toThrow();
            
            // Should still attempt cleanup
            expect(mockExecSync).toHaveBeenCalledWith(
                expect.stringContaining('rm -rf'),
                { stdio: 'ignore' }
            );
        });

        it("should ignore cleanup errors", async () => {
            mockExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('rm -rf')) {
                    throw new Error("Cleanup failed");
                }
                return "Success";
            });
            
            await expect(creator.createTables()).resolves.not.toThrow();
        });
    });

    describe("edge cases and error conditions", () => {
        it("should handle malformed bucket match in parsePartitioning", () => {
            const clause = "PARTITIONED BY (bucket(invalid, field))";
            const result = creator['parsePartitioning'](clause);
            expect(result).toEqual([]);
        });

        it("should handle createTable with table that has undefined methods", () => {
            const badTable = {
                tableName: "bad_table"
                // Missing getColumnDefinitions and getPartitioningClause methods
            };

            expect(() => {
                creator['generateTableDefinition'](badTable, "test-arn", "test-namespace");
            }).toThrow();
        });

        it("should handle table with non-standard column types", () => {
            const mockTable = {
                tableName: "test_table",
                getColumnDefinitions: () => ({
                    'col1': 'CUSTOM_TYPE',
                    'col2': 'varchar(255)'
                }),
                getPartitioningClause: () => ""
            };

            const definition = creator['generateTableDefinition'](
                mockTable, 
                "test-arn", 
                "test-namespace"
            );

            expect(definition.metadata.iceberg.schema.fields).toEqual([
                { name: "col1", type: "string", required: false },
                { name: "col2", type: "string", required: false }
            ]);
        });

        it("should handle createTables when table instantiation fails", async () => {
            // Mock PackageRevisionTable to throw an error
            (PackageRevisionTable as jest.Mock).mockImplementation(() => {
                throw new Error("Table instantiation failed");
            });

            await expect(creator.createTables()).rejects.toThrow("Table instantiation failed");
        });

        it("should handle directory creation during createTables", async () => {
            mockExecSync.mockReturnValue("Success");
            mockMkdirSync.mockImplementation(() => {
                throw new Error("Directory creation failed");
            });

            await expect(creator.createTables()).rejects.toThrow("Directory creation failed");
        });
    });
});
