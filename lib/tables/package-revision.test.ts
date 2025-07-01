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

describe("PackageRevisionTable", () => {
    let mockConfig: Config;
    
    beforeEach(() => {
        jest.clearAllMocks();
        glueMock.reset();
        athenaMock.reset();
        
        // Create a proper test config instance
        mockConfig = Config.createTestInstance({
            glueTablesBucket: "test-bucket",
            glueDatabaseName: "test-db",
            s3TablesBucket: "test-s3-bucket",
            s3TableDatabaseName: "test-s3-db"
        });
    });

    describe("ensureExists", () => {
        it("should skip creation when table already exists", async () => {
            tableExists.mockResolvedValue(true);

            await PackageRevisionTable.ensureExists(mockConfig, "source-view");

            expect(tableExists).toHaveBeenCalledWith(mockConfig, "package_revision");
            expect(athenaMock.calls()).toHaveLength(0);
        });

        it("should skip Glue table creation (lazy creation)", async () => {
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageRevisionTable.ensureExists(mockConfig, "source-view");

            expect(tableExists).toHaveBeenCalledWith(mockConfig, "package_revision");
            expect(executeQuery).toHaveBeenCalledTimes(0); // Should skip creation for Glue tables
        });

        it("should create S3 table immediately when it does not exist", async () => {
            const s3Config = S3Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageRevisionTable.ensureExists(s3Config, "source-view");

            expect(tableExists).toHaveBeenCalledWith(s3Config, "package_revision");
            expect(executeQuery).toHaveBeenCalledTimes(1);
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE test-s3-db.package_revision'),
                s3Config
            );
        });
    });

    describe("generateInsertQuery", () => {
        it("should generate correct INSERT query", () => {
            const context = createTestTableContext();
            const config = Config.createTestInstance();

            const query = PackageRevisionTable.generateInsertQuery(context, "source_table", config);

            expect(query).toContain('INSERT INTO "package_revision"');
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain('FROM "source_table" s');
            expect(query).toContain('LEFT JOIN "package_revision" t');
            expect(query).toContain("s.timestamp != 'latest'");
        });
    });

    describe("insert", () => {
        it("should create table with CTAS on first run for Glue tables", async () => {
            const context = createTestTableContext();
            tableExists.mockResolvedValue(false);
            executeQuery.mockResolvedValue(undefined);

            await PackageRevisionTable.insert(context, "source_table", mockConfig);

            expect(tableExists).toHaveBeenCalledWith(mockConfig, "package_revision");
            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE "package_revision"'),
                mockConfig
            );
        });

        it("should execute regular insert when table exists", async () => {
            const context = createTestTableContext();
            tableExists.mockResolvedValue(true);
            executeQuery.mockResolvedValue(undefined);

            await PackageRevisionTable.insert(context, "source_table", mockConfig);

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO "package_revision"'),
                mockConfig
            );
        });

        it("should execute regular insert for S3 tables", async () => {
            const s3Config = S3Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db", 
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const context = createTestTableContext();
            executeQuery.mockResolvedValue(undefined);

            await PackageRevisionTable.insert(context, "source_table", s3Config);

            expect(executeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO test-s3-db.package_revision'),
                s3Config
            );
        });
    });
});
