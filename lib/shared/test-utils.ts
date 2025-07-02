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

// Common test setup
export const setupTableTest = () => {
    beforeEach(() => {
        jest.clearAllMocks();
        glueMock.reset();
        athenaMock.reset();
    });
};

// Helper to mock successful Athena operations
export const mockSuccessfulAthenaOperation = () => {
    athenaMock
        .on(StartQueryExecutionCommand)
        .resolves({ QueryExecutionId: "test-id" })
        .on(GetQueryExecutionCommand)
        .resolves({
            QueryExecution: {
                Status: { State: QueryExecutionState.SUCCEEDED }
            }
        });
};

// Consolidated test setup for table classes
export interface TableTestSetup {
    mockConfig: Config;
    s3Config: S3Config;
    mockAthenaUtils: AthenaTest;
}

export function createTableTestSetup(): TableTestSetup {
    const mockConfig = Config.createTestInstance({
        glueTablesBucket: "test-bucket",
        glueDatabaseName: "test-db",
        s3TablesBucket: "test-s3-bucket",
        s3TableDatabaseName: "test-s3-db"
    });

    const s3Config = S3Config.createTestInstance({
        glueTablesBucket: "test-bucket",
        glueDatabaseName: "test-db",
        s3TablesBucket: "test-s3-bucket",
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
        createTableContains?: string[];
    } = {}
) {
    return () => {
        let setup: TableTestSetup;
        
        beforeEach(() => {
            setup = createTableTestSetup();
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
                
                // Additional expectations for specific tables
                if (additionalQueryExpectations.createTableContains) {
                    additionalQueryExpectations.createTableContains.forEach(expectation => {
                        expect(executeQuerySpy).toHaveBeenCalledWith(
                            expect.stringContaining(expectation)
                        );
                    });
                }
            });
        });

        describe("generateInsertQuery", () => {
            it("should generate correct INSERT query", () => {
                const context = createTestTableContext();
                const config = Config.createTestInstance({
                    glueTablesBucket: "test-bucket",
                    glueDatabaseName: "test-db",
                    s3TablesBucket: "test-s3-bucket",
                    s3TableDatabaseName: "test-s3-db"
                });
                const instance = new TableClass(context, config);

                const query = instance.generateInsertQuery(context, "source_table");

                expect(query).toContain(`INSERT INTO ${tableName}`);
                expect(query).toContain("'test_registry' AS registry");
                expect(query).toContain('FROM source_table s');
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
            it("should create table with CTAS on first run for Glue tables", async () => {
                const context = createTestTableContext();
                jest.spyOn(setup.mockAthenaUtils, 'tableExists').mockResolvedValue(false);
                const executeQuerySpy = jest.spyOn(setup.mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

                await TableClass.insert(context, "source_table", setup.mockConfig, setup.mockAthenaUtils);

                expect(setup.mockAthenaUtils.tableExists).toHaveBeenCalledWith(tableName);
                expect(executeQuerySpy).toHaveBeenCalledWith(
                    expect.stringContaining(`CREATE TABLE ${tableName}`)
                );
            });

            it("should execute regular insert when table exists", async () => {
                const context = createTestTableContext();
                jest.spyOn(setup.mockAthenaUtils, 'tableExists').mockResolvedValue(true);
                const executeQuerySpy = jest.spyOn(setup.mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

                await TableClass.insert(context, "source_table", setup.mockConfig, setup.mockAthenaUtils);

                expect(executeQuerySpy).toHaveBeenCalledWith(
                    expect.stringContaining(`INSERT INTO ${tableName}`)
                );
            });

            it("should execute regular insert for S3 tables", async () => {
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
