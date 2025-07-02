import { PackageEntryTable } from "./package-entry";
import { TableContext } from "../shared/types";
import { createTestTableContext } from "../shared/test-utils";
import { Config, S3Config } from "../shared/config";
import { AthenaUtils } from "../shared/athena-utils";

describe("PackageEntryTable", () => {
    let mockConfig: Config;
    let mockAthenaUtils: AthenaUtils;
    
    beforeEach(() => {
        // Create a proper test config instance
        mockConfig = Config.createTestInstance({
            glueTablesBucket: "test-bucket",
            glueDatabaseName: "test-db",
            s3TablesBucket: "test-s3-bucket",
            s3TableDatabaseName: "test-s3-db"
        });
        
        // Create test instances with mocked AWS clients
        mockAthenaUtils = AthenaUtils.createTestInstance(mockConfig);
    });

    describe("ensureExists", () => {
        it("should skip creation when table already exists", async () => {
            jest.spyOn(mockAthenaUtils, 'tableExists').mockResolvedValue(true);
            const executeQuerySpy = jest.spyOn(mockAthenaUtils, 'executeQuery');

            await PackageEntryTable.ensureExists(mockConfig, "source-view", mockAthenaUtils);

            expect(mockAthenaUtils.tableExists).toHaveBeenCalledWith("package_entry");
            expect(executeQuerySpy).not.toHaveBeenCalled();
        });

        it("should skip Glue table creation (lazy creation)", async () => {
            jest.spyOn(mockAthenaUtils, 'tableExists').mockResolvedValue(false);
            const executeQuerySpy = jest.spyOn(mockAthenaUtils, 'executeQuery');

            await PackageEntryTable.ensureExists(mockConfig, "source-view", mockAthenaUtils);

            expect(mockAthenaUtils.tableExists).toHaveBeenCalledWith("package_entry");
            expect(executeQuerySpy).not.toHaveBeenCalled();
        });

        it("should create S3 table immediately when it does not exist", async () => {
            const s3Config = S3Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            
            jest.spyOn(mockAthenaUtils, 'tableExists').mockResolvedValue(false);
            const executeQuerySpy = jest.spyOn(mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

            await PackageEntryTable.ensureExists(s3Config, "source-view", mockAthenaUtils);

            expect(mockAthenaUtils.tableExists).toHaveBeenCalledWith("package_entry");
            expect(executeQuerySpy).toHaveBeenCalledTimes(1);
            expect(executeQuerySpy).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE test-s3-db.package_entry')
            );
        });
    });

    describe("generateInsertQuery", () => {
        it("should generate correct INSERT query", () => {
            const context = createTestTableContext();
            const config = Config.createTestInstance();

            const query = PackageEntryTable.generateInsertQuery(context, "source_table", config);

            expect(query).toContain('INSERT INTO "package_entry"');
            expect(query).toContain("'test_registry' AS registry");
            expect(query).toContain('FROM "source_table" s');
            expect(query).toContain('LEFT JOIN "package_entry" t');
        });
    });

    describe("insert", () => {
        it("should create table with CTAS on first run for Glue tables", async () => {
            const context = createTestTableContext();
            jest.spyOn(mockAthenaUtils, 'tableExists').mockResolvedValue(false);
            const executeQuerySpy = jest.spyOn(mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

            await PackageEntryTable.insert(context, "source_table", mockConfig, mockAthenaUtils);

            expect(mockAthenaUtils.tableExists).toHaveBeenCalledWith("package_entry");
            expect(executeQuerySpy).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE package_entry')
            );
        });

        it("should execute regular insert when table exists", async () => {
            const context = createTestTableContext();
            jest.spyOn(mockAthenaUtils, 'tableExists').mockResolvedValue(true);
            const executeQuerySpy = jest.spyOn(mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

            await PackageEntryTable.insert(context, "source_table", mockConfig, mockAthenaUtils);

            expect(executeQuerySpy).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO "package_entry"')
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
            const executeQuerySpy = jest.spyOn(mockAthenaUtils, 'executeQuery').mockResolvedValue(undefined);

            await PackageEntryTable.insert(context, "source_table", s3Config, mockAthenaUtils);

            expect(executeQuerySpy).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO test-s3-db.package_entry')
            );
        });
    });
});
