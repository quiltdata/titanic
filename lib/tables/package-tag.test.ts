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

describe("PackageTagTable", () => {
    let originalGetInstance: any;
    
    beforeEach(() => {
        jest.clearAllMocks();
        glueMock.reset();
        athenaMock.reset();
    });

    describe("ensureExists", () => {
        it("should skip creation when table already exists", async () => {
            const testConfig = Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            tableExists.mockResolvedValue(true);

            await PackageTagTable.ensureExists(testConfig, "source-view");

            expect(tableExists).toHaveBeenCalledWith(testConfig, "package_tag");
            expect(athenaMock.calls()).toHaveLength(0);
        });

        it("should skip Glue table creation (lazy creation)", async () => {
            const testConfig = Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket", 
                s3TableDatabaseName: "test-s3-db"
            });
            
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageTagTable.ensureExists(testConfig, "source-view");

            expect(tableExists).toHaveBeenCalledWith(testConfig, "package_tag");
            expect(executeQuery).toHaveBeenCalledTimes(0); // Should skip creation for Glue tables
        });

        it("should create S3 table immediately when it does not exist", async () => {
            const testS3Config = S3Config.createTestInstance({
                glueDatabaseName: "test-glue-db", 
                s3TableDatabaseName: "test-s3-db",
                s3TablesBucket: "test-s3-bucket"
            });
            
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageTagTable.ensureExists(testS3Config, "source-view");

            expect(tableExists).toHaveBeenCalledWith(testS3Config, "package_tag");
            expect(executeQuery).toHaveBeenCalledTimes(1);
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE test-s3-db.package_tag'),
                testS3Config
            );
        });
    });

    describe("generateInsertQuery", () => {
        it("should generate correct INSERT query for tags", () => {
            const testConfig = Config.createTestInstance({
                glueDatabaseName: "test-db",
                glueTablesBucket: "test-bucket"
            });
            
            const context = createTestTableContext();

            const query = PackageTagTable.generateInsertQuery(context, "source_table", testConfig);

            expect(query).toContain('INSERT INTO "package_tag"');
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain("s.timestamp AS tag_name");
            expect(query).toContain('FROM "source_table" s');
            expect(query).toContain('LEFT JOIN "package_tag" t');
            expect(query).toContain("s.timestamp = 'latest'");
            expect(query).toContain("t.top_hash IS NULL OR s.top_hash != t.top_hash");
        });
    });

    describe("insert", () => {
        it("should create table with CTAS on first run for Glue tables", async () => {
            const testConfig = Config.createTestInstance({
                glueDatabaseName: "test-db",
                glueTablesBucket: "test-bucket"
            });
            
            const context = createTestTableContext();
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageTagTable.insert(context, "source_table", testConfig);

            expect(tableExists).toHaveBeenCalledWith(testConfig, "package_tag");
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE "package_tag"'),
                testConfig
            );
        });

        it("should execute regular insert when table exists", async () => {
            const testConfig = Config.createTestInstance({
                glueDatabaseName: "test-db",
                glueTablesBucket: "test-bucket"
            });
            
            const context = createTestTableContext();
            tableExists.mockResolvedValue(true);
            executeQuery.mockResolvedValue(undefined);

            await PackageTagTable.insert(context, "source_table", testConfig);

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO "package_tag"'),
                testConfig
            );
        });

        it("should execute regular insert for S3 tables", async () => {
            const testS3Config = S3Config.createTestInstance({
                glueDatabaseName: "test-db",
                glueTablesBucket: "test-bucket",
                s3TableDatabaseName: "test-s3-db",
                s3TablesBucket: "test-s3-bucket"
            });
            
            const context = createTestTableContext();
            executeQuery.mockResolvedValue(undefined);

            await PackageTagTable.insert(context, "source_table", testS3Config);

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO test-s3-db.package_tag'),
                testS3Config
            );
        });
    });
});
