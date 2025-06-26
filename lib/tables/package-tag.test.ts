import { mockClient } from "aws-sdk-client-mock";
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { PackageTagTable } from "./package-tag";
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

describe("PackageTagTable", () => {
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

            await PackageTagTable.ensureExists("test-db", "test-bucket", "source-view");

            expect(tableExists).toHaveBeenCalledWith("test-db", "package_tag");
            expect(athenaMock.calls()).toHaveLength(0);
        });

        it("should create table when it does not exist", async () => {
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageTagTable.ensureExists("test-db", "test-bucket", "source-view");

            expect(tableExists).toHaveBeenCalledWith("test-db", "package_tag");
            expect(executeQuery).toHaveBeenCalledTimes(1);
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE "test-db"."package_tag"'),
                "test-bucket",
                "test-db",
                false
            );
        });
    });

    describe("generateInsertQuery", () => {
        it("should generate correct INSERT query for tags", () => {
            const context = createTestTableContext();

            const query = PackageTagTable.generateInsertQuery(context, "source_table");

            expect(query).toContain('INSERT INTO "test-db"."package_tag"');
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain("s.timestamp AS tag_name");
            expect(query).toContain('FROM "test-db"."source_table" s');
            expect(query).toContain('LEFT JOIN "test-db"."package_tag" t');
            expect(query).toContain("s.timestamp = 'latest'");
            expect(query).toContain("t.top_hash IS NULL OR s.top_hash != t.top_hash");
        });
    });

    describe("insert", () => {
        it("should execute insert query", async () => {
            const context = createTestTableContext();

            await PackageTagTable.insert(context, "source_table");

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO "test-db"."package_tag"'),
                "test-bucket",
                "test-db",
                false
            );
        });
    });
});
