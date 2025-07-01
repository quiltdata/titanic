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
import { createTestTableContext } from "../shared/test-utils";
import { Config, S3Config } from "../shared/config";

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
    let mockConfig: Config;
    let mockS3Config: S3Config;
    
    beforeEach(() => {
        jest.clearAllMocks();
        glueMock.reset();
        athenaMock.reset();
        
        mockConfig = Config.createTestInstance({
            glueDatabaseName: "test-db",
            glueTablesBucket: "test-bucket"
        });
        
        mockS3Config = S3Config.createTestInstance({
            glueDatabaseName: "test-db",
            glueTablesBucket: "test-bucket",
            s3TableDatabaseName: "test-s3-db",
            s3TablesBucket: "test-s3-bucket"
        });
    });

    describe("ensureExists", () => {
        it("should skip creation when table already exists", async () => {
            tableExists.mockResolvedValue(true);

            await PackageEntryTable.ensureExists(mockConfig, "source-view");

            expect(tableExists).toHaveBeenCalledWith(mockConfig, "package_entry");
            expect(athenaMock.calls()).toHaveLength(0);
        });

        it("should skip Glue table creation (lazy creation)", async () => {
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);
            
            await PackageEntryTable.ensureExists(mockConfig, "source-view");

            expect(tableExists).toHaveBeenCalledWith(mockConfig, "package_entry");
            expect(executeQuery).toHaveBeenCalledTimes(0); // Should skip creation for Glue tables
        });

        it("should create S3 table immediately when it does not exist", async () => {
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);
            
            await PackageEntryTable.ensureExists(mockS3Config, "source-view");

            expect(tableExists).toHaveBeenCalledWith(mockS3Config, "package_entry");
            expect(executeQuery).toHaveBeenCalledTimes(1);
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE test-s3-db.package_entry'),
                mockS3Config
            );
        });
    });

    describe("generateInsertQuery", () => {
        it("should generate correct INSERT query with multihash conversion", () => {
            const context = createTestTableContext();

            const query = PackageEntryTable.generateInsertQuery(context, "source_table", mockConfig);

            expect(query).toContain('INSERT INTO "package_entry"');
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain('FROM "source_table" s');
            expect(query).toContain('LEFT JOIN "package_entry" t');
            
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
        it("should create table with CTAS on first run for Glue tables", async () => {
            const context = createTestTableContext();
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageEntryTable.insert(context, "source_table", mockConfig);

            expect(tableExists).toHaveBeenCalledWith(mockConfig, "package_entry");
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE "package_entry"'),
                mockConfig
            );
        });

        it("should execute regular insert when table exists", async () => {
            const context = createTestTableContext();
            tableExists.mockResolvedValue(true);
            executeQuery.mockResolvedValue(undefined);

            await PackageEntryTable.insert(context, "source_table", mockConfig);

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO "package_entry"'),
                mockConfig
            );
        });

        it("should execute regular insert for S3 tables", async () => {
            const context = createTestTableContext();
            executeQuery.mockResolvedValue(undefined);

            await PackageEntryTable.insert(context, "source_table", mockS3Config);

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO test-s3-db.package_entry'),
                mockS3Config
            );
        });
    });
});
