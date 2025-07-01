import { PackageRevisionTable } from "./package-revision";
import { Config, S3Config } from "../shared/config";

describe("Table Schema Configuration", () => {
    describe("Glue mode (default)", () => {
        it("should generate CREATE TABLE with WITH clause by default", () => {
            const config = Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table = new PackageRevisionTable(config);
            const schema = (table as any).getCompleteCreateTableSchema();
            
            expect(schema).toContain('CREATE TABLE "package_revision"');
            expect(schema).toContain("WITH (");
            expect(schema).toContain("format = 'iceberg'");
        });

        it("should generate CREATE TABLE with WITH clause when explicitly disabled", () => {
            const config = Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table = new PackageRevisionTable(config);
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", false);
            
            expect(schema).toContain('CREATE TABLE "package_revision"');
            expect(schema).not.toContain("PARTITIONED BY");
            expect(schema).toContain("WITH (");
            expect(schema).toContain("format = 'iceberg'");
        });
    });

    describe("S3 Tables mode", () => {
        it("should generate CREATE TABLE with partitioning when S3 Tables mode enabled", () => {
            const config = S3Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table = new PackageRevisionTable(config);
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket");
            
            expect(schema).toContain('CREATE TABLE test-s3-db.package_revision');
            expect(schema).toContain("LOCATION 's3://test-s3-bucket/package_revision/'");
        });
    });

    describe("Schema generation", () => {
        it("should correctly combine base schema with partitioning clause for S3 Tables", () => {
            const config = S3Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table = new PackageRevisionTable(config);
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket");
            
            // S3 Tables should have LOCATION but no WITH clause or PARTITIONED BY
            expect(schema).toContain("CREATE TABLE test-s3-db.package_revision");
            expect(schema).toContain("LOCATION 's3://test-s3-bucket/package_revision/'");
            expect(schema).not.toContain("WITH (");
            expect(schema).not.toContain("PARTITIONED BY");
        });

        it("should return schema with WITH clause for Glue mode", () => {
            const config = Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table = new PackageRevisionTable(config);
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket");
            
            // Should end with WITH clause, no LOCATION clause
            expect(schema.trim()).toMatch(/WITH\s*\(/);
            expect(schema.trim()).not.toMatch(/\)\s*PARTITIONED BY/);
            expect(schema).toContain("format = 'iceberg'");
            expect(schema).not.toContain("LOCATION");
        });

        it("should handle default static property as Glue mode", () => {
            const config = Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table = new PackageRevisionTable(config);
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket");
            
            expect(schema).not.toContain("PARTITIONED BY");
            expect(schema).toContain("WITH (");
            expect(schema).toContain("format = 'iceberg'");
            expect(schema).not.toContain("LOCATION");
        });

        it("should correctly generate S3 Tables with partitions but no WITH clause", () => {
            // Test S3 Tables mode
            const s3Config = S3Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table1 = new PackageRevisionTable(s3Config);
            const s3Schema = (table1 as any).getCompleteCreateTableSchema("test-db", "test-bucket");
            
            // Test Glue mode
            const glueConfig = Config.createTestInstance({
                glueTablesBucket: "test-bucket",
                glueDatabaseName: "test-db",
                s3TablesBucket: "test-s3-bucket",
                s3TableDatabaseName: "test-s3-db"
            });
            const table2 = new PackageRevisionTable(glueConfig);
            const glueSchema = (table2 as any).getCompleteCreateTableSchema("test-db", "test-bucket");
            
            // S3 Tables should have LOCATION but no WITH clause or partitions
            expect(s3Schema).toContain("LOCATION");
            expect(s3Schema).not.toContain("WITH (");
            expect(s3Schema).not.toContain("format = 'iceberg'");
            expect(s3Schema).not.toContain("PARTITIONED BY");
            
            // Glue mode should have WITH clause but no LOCATION or partitions
            expect(glueSchema).not.toContain("PARTITIONED BY");
            expect(glueSchema).toContain("WITH (");
            expect(glueSchema).toContain("format = 'iceberg'");
            expect(glueSchema).not.toContain("LOCATION");
        });
    });
});
