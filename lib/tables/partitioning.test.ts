import { PackageRevisionTable } from "./package-revision";

describe("Runtime Table Configuration", () => {
    describe("PackageRevisionTable as Iceberg table (default)", () => {
        it("should generate CREATE TABLE with WITH clause by default", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", false);
            
            expect(schema).toContain('CREATE TABLE "test-db"."package_revision"');
            expect(schema).not.toContain("PARTITIONED BY");
            expect(schema).toContain("WITH (");
            expect(schema).toContain("format = 'PARQUET'");
            expect(schema).toContain("table_type = 'ICEBERG'");
            expect(schema).toContain("location = 's3://test-bucket/iceberg_catalog/package_revision/'");
        });

        it("should generate CREATE TABLE with WITH clause when explicitly disabled", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", false);
            
            expect(schema).toContain('CREATE TABLE "test-db"."package_revision"');
            expect(schema).not.toContain("PARTITIONED BY");
            expect(schema).toContain("WITH (");
            expect(schema).toContain("format = 'PARQUET'");
            expect(schema).toContain("table_type = 'ICEBERG'");
            expect(schema).toContain("location = 's3://test-bucket/iceberg_catalog/package_revision/'");
        });
    });

    describe("PackageRevisionTable as S3 table", () => {
        it("should generate CREATE TABLE with partitioning when S3 mode enabled", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", true);
            
            expect(schema).toContain('CREATE TABLE "test-db"."package_revision"');
            expect(schema).toContain("PARTITIONED BY");
            expect(schema).toContain("bucket(8, pkg_name)");
            expect(schema).toContain("bucket(8, top_hash)");
            expect(schema).not.toContain("WITH (");
        });
    });

    describe("Schema generation", () => {
        it("should correctly combine base schema with partitioning clause for S3 tables", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", true);
            
            // Should contain both the base table definition and partitioning, no WITH clause
            expect(schema).toMatch(/CREATE TABLE.*\)\s*PARTITIONED BY/s);
            expect(schema).not.toContain("WITH (");
        });

        it("should return schema with WITH clause for Iceberg tables", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", false);
            
            // Should end with WITH clause, no partitioning clause
            expect(schema.trim()).toMatch(/WITH\s*\(/);
            expect(schema.trim()).not.toMatch(/\)\s*PARTITIONED BY/);
            expect(schema).toContain("table_type = 'ICEBERG'");
            expect(schema).toContain("location = 's3://test-bucket/iceberg_catalog/package_revision/'");
        });

        it("should handle undefined useS3Table parameter as Iceberg (default)", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket");
            
            expect(schema).not.toContain("PARTITIONED BY");
            expect(schema).toContain("WITH (");
            expect(schema).toContain("table_type = 'ICEBERG'");
            expect(schema).toContain("location = 's3://test-bucket/iceberg_catalog/package_revision/'");
        });

        it("should correctly generate S3 table with partitions but no WITH clause", () => {
            const table = new PackageRevisionTable();
            const s3Schema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", true);
            const icebergSchema = (table as any).getCompleteCreateTableSchema("test-db", "test-bucket", false);
            
            // S3 table should have partitions but no WITH clause
            expect(s3Schema).toContain("PARTITIONED BY");
            expect(s3Schema).not.toContain("WITH (");
            expect(s3Schema).not.toContain("table_type = 'ICEBERG'");
            
            // Iceberg table should have WITH clause but no partitions
            expect(icebergSchema).not.toContain("PARTITIONED BY");
            expect(icebergSchema).toContain("WITH (");
            expect(icebergSchema).toContain("table_type = 'ICEBERG'");
            expect(icebergSchema).toContain("location = 's3://test-bucket/iceberg_catalog/package_revision/'");
        });
    });
});
