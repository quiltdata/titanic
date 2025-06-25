import { PackageRevisionTable } from "./package-revision";

describe("Runtime Partitioning Configuration", () => {
    describe("PackageRevisionTable with partitioning disabled", () => {
        it("should generate CREATE TABLE without partitioning by default", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", false);
            
            expect(schema).toContain('CREATE TABLE IF NOT EXISTS "test-db"."package_revision"');
            expect(schema).not.toContain("PARTITIONED BY");
        });

        it("should generate CREATE TABLE without partitioning when explicitly disabled", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", false);
            
            expect(schema).toContain('CREATE TABLE IF NOT EXISTS "test-db"."package_revision"');
            expect(schema).not.toContain("PARTITIONED BY");
        });
    });

    describe("PackageRevisionTable with partitioning enabled", () => {
        it("should generate CREATE TABLE with partitioning when enabled", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", true);
            
            expect(schema).toContain('CREATE TABLE IF NOT EXISTS "test-db"."package_revision"');
            expect(schema).toContain("PARTITIONED BY");
            expect(schema).toContain("bucket(8, pkg_name)");
            expect(schema).toContain("bucket(8, top_hash)");
        });
    });

    describe("Schema generation", () => {
        it("should correctly combine base schema with partitioning clause when enabled", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", true);
            
            // Should contain both the base table definition and partitioning
            expect(schema).toMatch(/CREATE TABLE.*\)\s*PARTITIONED BY/s);
        });

        it("should return clean schema without partitioning when disabled", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db", false);
            
            // Should end with the closing parenthesis, no partitioning clause
            expect(schema.trim()).toMatch(/\)$/);
            expect(schema.trim()).not.toMatch(/\)\s*PARTITIONED BY/);
        });

        it("should handle undefined partitioning parameter as disabled", () => {
            const table = new PackageRevisionTable();
            const schema = (table as any).getCompleteCreateTableSchema("test-db");
            
            expect(schema).not.toContain("PARTITIONED BY");
        });
    });
});
