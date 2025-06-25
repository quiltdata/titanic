import { mockClient } from "aws-sdk-client-mock";
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { PackageEntryTable } from "./package-entry";
import { TableContext } from "../shared/types";

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

describe("PackageEntryTable", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        glueMock.reset();
        athenaMock.reset();
    });

    describe("ensureExists", () => {
        it("should skip creation when table already exists", async () => {
            tableExists.mockResolvedValue(true);

            await PackageEntryTable.ensureExists("test-db", "test-bucket", "source-view");

            expect(tableExists).toHaveBeenCalledWith("test-db", "package_entry");
            expect(athenaMock.calls()).toHaveLength(0);
        });

        it("should create table when it does not exist", async () => {
            tableExists.mockResolvedValue(false);
            athenaMock
                .on(StartQueryExecutionCommand)
                .resolves({ QueryExecutionId: "test-id" })
                .on(GetQueryExecutionCommand)
                .resolves({
                    QueryExecution: {
                        Status: { State: QueryExecutionState.SUCCEEDED }
                    }
                });

            await PackageEntryTable.ensureExists("test-db", "test-bucket", "source-view");

            expect(tableExists).toHaveBeenCalledWith("test-db", "package_entry");
            expect(athenaMock.calls()).toHaveLength(2);
        });
    });

    describe("generateInsertQuery", () => {
        it("should generate correct INSERT query with multihash conversion", () => {
            const context: TableContext = {
                databaseName: "test-db",
                targetBucket: "test-bucket",
                registryName: "test_registry"
            };

            const query = PackageEntryTable.generateInsertQuery(context, "source_table");

            expect(query).toContain('INSERT INTO "test-db"."package_entry"');
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain('FROM "test-db"."source_table" s');
            expect(query).toContain('LEFT JOIN "test-db"."package_entry" t');
            
            // Check multihash conversion logic
            expect(query).toContain("CASE s.hash.type");
            expect(query).toContain("WHEN 'SHA256' THEN '1220'");
            expect(query).toContain("WHEN 'sha2-256-chunked' THEN 'b150'");
            expect(query).toContain("ELSE '0000'");
            expect(query).toContain("s.hash.value");
            expect(query).toContain("AS multihash");
            
            // Check join conditions
            expect(query).toContain("s.logical_key = t.logical_key");
            expect(query).toContain("s.meta = t.metadata");
            expect(query).toContain("s.top_hash = t.top_hash");
            expect(query).toContain("t.registry = 'test_registry'");
            expect(query).toContain("t.logical_key IS NULL");
        });
    });

    describe("insert", () => {
        it("should execute insert query", async () => {
            const context: TableContext = {
                databaseName: "test-db",
                targetBucket: "test-bucket",
                registryName: "test_registry"
            };

            await PackageEntryTable.insert(context, "source_table");

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO "test-db"."package_entry"'),
                "test-bucket"
            );
        });
    });
});
