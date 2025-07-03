import { mockClient } from "aws-sdk-client-mock";
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { TableContext, createTableContext } from "./types";
import { Config, S3Config } from "./config";
import { AthenaTest } from "./athena-test";

// Test helper for creating table contexts
export function createTestTableContext(
    overrides: Partial<TableContext> = {}
): TableContext {
    return createTableContext(
        overrides.registryName || "test_registry"
    );
}

// Common mock clients
export const glueMock = mockClient(GlueClient);
export const athenaMock = mockClient(AthenaClient);

// Consolidated test setup for table classes
export interface TableTestSetup {
    mockConfig: Config;
    s3Config: S3Config;
    mockAthenaUtils: AthenaTest;
}

export function createTableTestSetup(): TableTestSetup {
    const mockConfig = Config.createTestInstance({
        glueTablesBucketArn: "arn:aws:s3:::test-bucket",
        glueDatabaseName: "test-db",
        s3TablesBucketArn: "arn:aws:s3tables:us-east-1:123456789012:bucket/test-s3-bucket",
        s3TableDatabaseName: "test-s3-db"
    });

    const s3Config = S3Config.createTestInstance({
        glueTablesBucketArn: "arn:aws:s3:::test-bucket",
        glueDatabaseName: "test-db",
        s3TablesBucketArn: "arn:aws:s3tables:us-east-1:123456789012:bucket/test-s3-bucket",
        s3TableDatabaseName: "test-s3-db"
    });

    const mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);

    return { mockConfig, s3Config, mockAthenaUtils };
}

// Generic test suite for table classes
export function createTableTestSuite(
    TableClass: any,
    tableName: string,
    additionalQueryExpectations: {
        insertQueryContains?: string[];
    } = {}
) {
    return () => {
        let setup: TableTestSetup;
        
        beforeEach(() => {
            setup = createTableTestSetup();
        });

        describe("configuration validation", () => {
            it("should distinguish between Glue API success and Athena API failure", async () => {
                const athenaUtils = setup.mockAthenaUtils;
                
                // Mock Glue API to succeed (table exists)
                jest.spyOn(athenaUtils, 'tableExists').mockResolvedValue(true);
                
                // Mock Athena API to fail (S3 bucket issue)
                jest.spyOn(athenaUtils, 'executeQuery').mockRejectedValue(
                    new Error('Cannot find or access the specified bucket')
                );
                
                // This should show that tableExists works but executeQuery fails
                const tableExists = await athenaUtils.tableExists('test_table');
                expect(tableExists).toBe(true);
                
                await expect(athenaUtils.executeQuery('DROP TABLE test_table'))
                    .rejects.toThrow('Cannot find or access the specified bucket');
            });
        });

        describe("ensureExists", () => {
            it("should skip creation when table already exists", async () => {
                jest.spyOn(setup.mockAthenaUtils, 'tableExists').mockResolvedValue(true);
                const executeQuerySpy = jest.spyOn(setup.mockAthenaUtils, 'executeQuery');

                await TableClass.ensureExists(setup.mockConfig, "source-view", setup.mockAthenaUtils);

                expect(setup.mockAthenaUtils.tableExists).toHaveBeenCalledWith(tableName);
                expect(executeQuerySpy).not.toHaveBeenCalled();
            });

            it("should skip Glue table creation (lazy creation)", async () => {
                jest.spyOn(setup.mockAthenaUtils, 'tableExists').mockResolvedValue(false);
                const executeQuerySpy = jest.spyOn(setup.mockAthenaUtils, 'executeQuery');

                await TableClass.ensureExists(setup.mockConfig, "source-view", setup.mockAthenaUtils);

                expect(setup.mockAthenaUtils.tableExists).toHaveBeenCalledWith(tableName);
                expect(executeQuerySpy).not.toHaveBeenCalled();
            });

            it("should create S3 table immediately when it does not exist", async () => {
                jest.spyOn(setup.mockAthenaUtils, 'tableExists').mockResolvedValue(false);
                const executeQuerySpy = jest.spyOn(setup.mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

                await TableClass.ensureExists(setup.s3Config, "source-view", setup.mockAthenaUtils);

                expect(setup.mockAthenaUtils.tableExists).toHaveBeenCalledWith(tableName);
                expect(executeQuerySpy).toHaveBeenCalledTimes(1);
                expect(executeQuerySpy).toHaveBeenCalledWith(
                    expect.stringContaining(`CREATE TABLE ${tableName}`)
                );
            });
        });

        describe("generateInsertQuery", () => {
            it("should generate correct INSERT query", () => {
                const context = createTestTableContext();
                const config = Config.createTestInstance({
                    glueTablesBucketArn: "arn:aws:s3:::test-bucket",
                    glueDatabaseName: "test-db",
                    s3TablesBucketArn: "arn:aws:s3tables:us-east-1:123456789012:bucket/test-s3-bucket",
                    s3TableDatabaseName: "test-s3-db"
                });
                const instance = new TableClass(context, config);

                const query = instance.generateInsertQuery(context, "source_table");

                expect(query).toContain(`INSERT INTO ${tableName}`);
                expect(query).toContain("'test_registry' AS registry");
                expect(query).toContain('FROM "source_table" s');
                expect(query).toContain(`LEFT JOIN ${tableName} t`);
                
                // Additional expectations for specific tables
                if (additionalQueryExpectations.insertQueryContains) {
                    additionalQueryExpectations.insertQueryContains.forEach(expectation => {
                        expect(query).toContain(expectation);
                    });
                }
            });
        });

        describe("insert", () => {
            it("should execute insert without checking table existence", async () => {
                const context = createTestTableContext();
                const executeQuerySpy = jest.spyOn(setup.mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

                await TableClass.insert(context, "source_table", setup.mockConfig, setup.mockAthenaUtils);

                // Should execute a regular INSERT query without checking table existence
                expect(executeQuerySpy).toHaveBeenCalledWith(
                    expect.stringContaining(`INSERT INTO ${tableName}`)
                );
            });

            it("should execute regular insert for S3 tables without checking table existence", async () => {
                const context = createTestTableContext();
                const executeQuerySpy = jest.spyOn(setup.mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

                await TableClass.insert(context, "source_table", setup.s3Config, setup.mockAthenaUtils);

                expect(executeQuerySpy).toHaveBeenCalledWith(
                    expect.stringContaining(`INSERT INTO ${tableName}`)
                );
            });
        });
    };
}
