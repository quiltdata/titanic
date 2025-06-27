import { mockClient } from "aws-sdk-client-mock";
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { TableContext, createTableContext } from "./types";

// Test helper for creating table contexts
export function createTestTableContext(
    overrides: Partial<TableContext> = {}
): TableContext {
    return createTableContext(
        overrides.sourceDatabaseName || "test-db",
        overrides.targetDatabaseName || "test-db",
        overrides.targetBucket || "test-bucket", 
        overrides.registryName || "test_registry",
        overrides.useS3Table || false
    );
}

// Mock the athena-utils module - this setup should be used in all table tests
export const mockAthenaUtils = () => {
    jest.mock("../shared/athena-utils", () => {
        const actualModule = jest.requireActual("../shared/athena-utils");
        return {
            ...actualModule,
            glueClient: actualModule.glueClient,
            athenaClient: actualModule.athenaClient,
            tableExists: jest.fn(),
            executeQuery: jest.fn(),
        };
    });
};

// Common mock clients
export const glueMock = mockClient(GlueClient);
export const athenaMock = mockClient(AthenaClient);

// Helper to get mocked functions
export const getMockedUtils = () => {
    const { tableExists, executeQuery } = require("../shared/athena-utils");
    return { tableExists, executeQuery };
};

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

// Common table existence test cases
export const createTableExistenceTests = (
    tableClass: any,
    tableName: string,
    testTableExists: any,
    testExecuteQuery: any
) => {
    describe("ensureExists", () => {
        it("should skip creation when table already exists", async () => {
            testTableExists.mockResolvedValue(true);

            await tableClass.ensureExists("test-db", "test-bucket", "source-view");

            expect(testTableExists).toHaveBeenCalledWith("test-db", tableName);
            expect(athenaMock.calls()).toHaveLength(0);
        });

        it("should create table when it does not exist", async () => {
            testTableExists.mockResolvedValue(false);
            mockSuccessfulAthenaOperation();

            await tableClass.ensureExists("test-db", "test-bucket", "source-view");

            expect(testTableExists).toHaveBeenCalledWith("test-db", tableName);
            expect(athenaMock.calls()).toHaveLength(2);
        });
    });
};

// Common insert query test cases
export const createInsertQueryTests = (
    tableClass: any,
    tableName: string,
    expectedQueryContains: string[],
    testExecuteQuery: any
) => {
    describe("generateInsertQuery", () => {
        it(`should generate correct INSERT query for ${tableName}`, () => {
            const context = createTestTableContext();

            const query = tableClass.generateInsertQuery(context, "source_table");

            expect(query).toContain(`INSERT INTO "test-db"."${tableName}"`);
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain('FROM "test-db"."source_table" s');
            expect(query).toContain(`LEFT JOIN "test-db"."${tableName}" t`);
            
            expectedQueryContains.forEach(expectedContent => {
                expect(query).toContain(expectedContent);
            });
        });
    });

    describe("insert", () => {
        it("should execute insert query", async () => {
            const context = createTestTableContext();

            await tableClass.insert(context, "source_table");

            expect(testExecuteQuery).toHaveBeenCalledWith(
                expect.stringContaining(`INSERT INTO "test-db"."${tableName}"`),
                "test-bucket"
            );
        });
    });
};
