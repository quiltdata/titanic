import { mockClient } from "aws-sdk-client-mock";
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { PackageRevisionTable } from "./package-revision";
import { TableContext } from "../shared/types";
import { createTestTableContext } from "../shared/test-utils";

// Mock the athena-utils module
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

const glueMock = mockClient(GlueClient);
const athenaMock = mockClient(AthenaClient);

// Import mocked functions
const { tableExists, executeQuery } = require("../shared/athena-utils");

describe("PackageRevisionTable", () => {
    beforeEach(() => {
        glueMock.reset();
        athenaMock.reset();
        jest.clearAllMocks();
    });
    beforeEach(() => {
        jest.clearAllMocks();
        glueMock.reset();
        athenaMock.reset();
    });

    describe("ensureExists", () => {
        it("should skip creation when table already exists", async () => {
            tableExists.mockResolvedValue(true);

            await PackageRevisionTable.ensureExists("test-db", "test-bucket", "source-view");

            expect(tableExists).toHaveBeenCalledWith("test-db", "package_revision");
            expect(athenaMock.calls()).toHaveLength(0);
        });

        it("should create table when it does not exist", async () => {
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageRevisionTable.ensureExists("test-db", "test-bucket", "source-view");

            expect(tableExists).toHaveBeenCalledWith("test-db", "package_revision");
            expect(executeQuery).toHaveBeenCalledTimes(1);
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE "test-db"."package_revision"'),
                "test-bucket"
            );
        });

        it("should throw error when CREATE query fails", async () => {
            tableExists.mockResolvedValue(false);
            executeQuery.mockRejectedValue(new Error("Query failed"));

            await expect(
                PackageRevisionTable.ensureExists("test-db", "test-bucket", "source-view")
            ).rejects.toThrow("Query failed");
        });
    });

    describe("generateInsertQuery", () => {
        it("should generate correct INSERT query", () => {
            const context = createTestTableContext();

            const query = PackageRevisionTable.generateInsertQuery(context, "source_table");

            expect(query).toContain('INSERT INTO "test-db"."package_revision"');
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain('FROM "test-db"."source_table" s');
            expect(query).toContain('LEFT JOIN "test-db"."package_revision" t');
            expect(query).toContain("s.timestamp != 'latest'");
        });
    });

    describe("insert", () => {
        it("should execute insert query", async () => {
            executeQuery.mockResolvedValue(undefined);
            const context = createTestTableContext();

            await PackageRevisionTable.insert(context, "source_table");

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO "test-db"."package_revision"'),
                "test-bucket"
            );
        });
    });
});
