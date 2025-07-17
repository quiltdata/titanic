/**
 * Schema Validation Tests
 * 
 * Verifies that the generated SQL from our table classes matches
 * the expected patterns documented in doc/schema.sql
 */

import { Config, S3Config } from '../shared/config';
import { PackageRevisionTable } from './package-revision';
import { PackageTagTable } from './package-tag';
import { PackageEntryTable } from './package-entry';

describe('Schema Validation Tests', () => {
    let glueConfig: Config;
    let s3Config: S3Config;
    const packagesView = 'test-registry_packages-view';
    const objectsView = 'test-registry_objects-view';
    
    beforeEach(() => {
        glueConfig = Config.createTestInstance({
            athenaDatabaseName: 'test-glue-db',
            glueTablesBucketName: 'test-glue-bucket',
            awsAccountId: '123456789012'
        });
        
        s3Config = S3Config.createTestInstance({
            s3TableDatabaseName: 'test-s3-db',
            s3TablesBucketName: 'test-s3-bucket',
            awsAccountId: '123456789012'
        });
    });

    describe('S3 Tables - CREATE TABLE Operations', () => {
        describe('package_revision S3 CREATE TABLE', () => {
            it('should generate correct S3 CREATE TABLE schema matching schema.sql', () => {
                const table = new PackageRevisionTable(s3Config);
                const schema = table['generateCreateQuery']();
                
                // Basic CREATE TABLE structure from schema.sql
                expect(schema).toContain('CREATE TABLE IF NOT EXISTS');
                expect(schema).toContain('package_revision');
                expect(schema).toContain('registry STRING');
                expect(schema).toContain('pkg_name STRING');
                expect(schema).toContain('top_hash STRING');
                expect(schema).toContain('timestamp TIMESTAMP');
                expect(schema).toContain('message STRING');
                expect(schema).toContain('metadata STRING');
                
                // Schema.sql shows S3 tables should include partitioning but NOT LOCATION clause
                expect(schema).toContain('PARTITIONED BY');
                expect(schema).toContain('registry,');
                expect(schema).toContain('bucket(8, pkg_name),');
                expect(schema).toContain('bucket(8, top_hash)');
                
                // Should include S3 Tables specific properties
                expect(schema).toContain("TBLPROPERTIES ('table_type' = 'ICEBERG', 'format' = 'PARQUET')");
                
                // Partitioning clause should be accessible separately
                const partitionClause = table['getPartitioningClause']();
                expect(partitionClause).toContain('PARTITIONED BY (');
                expect(partitionClause).toContain('registry,');
                expect(partitionClause).toContain('bucket(8, pkg_name),');
                expect(partitionClause).toContain('bucket(8, top_hash)');
            });
        });

        describe('package_tag S3 CREATE TABLE', () => {
            it('should generate correct S3 CREATE TABLE schema matching schema.sql', () => {
                const table = new PackageTagTable(s3Config);
                const schema = table['generateCreateQuery']();
                
                // Basic CREATE TABLE structure from schema.sql
                expect(schema).toContain('CREATE TABLE IF NOT EXISTS');
                expect(schema).toContain('package_tag');
                expect(schema).toContain('registry STRING');
                expect(schema).toContain('pkg_name STRING');
                expect(schema).toContain('tag_name STRING');
                expect(schema).toContain('top_hash STRING');
                
                // Schema.sql shows S3 tables should include partitioning but NOT LOCATION clause
                expect(schema).toContain('PARTITIONED BY');
                expect(schema).toContain('registry,');
                expect(schema).toContain('tag_name,');
                expect(schema).toContain('bucket(8, pkg_name)');
                
                // Should include S3 Tables specific properties
                expect(schema).toContain("TBLPROPERTIES ('table_type' = 'ICEBERG', 'format' = 'PARQUET')");
                
                // Partitioning clause should be accessible separately
                const partitionClause = table['getPartitioningClause']();
                expect(partitionClause).toContain('PARTITIONED BY (');
                expect(partitionClause).toContain('registry,');
                expect(partitionClause).toContain('tag_name,');
                expect(partitionClause).toContain('bucket(8, pkg_name)');
            });
        });

        describe('package_entry S3 CREATE TABLE', () => {
            it('should generate correct S3 CREATE TABLE schema matching schema.sql', () => {
                const table = new PackageEntryTable(s3Config);
                const schema = table['generateCreateQuery']();
                
                // Basic CREATE TABLE structure from schema.sql
                expect(schema).toContain('CREATE TABLE IF NOT EXISTS');
                expect(schema).toContain('package_entry');
                expect(schema).toContain('registry STRING');
                expect(schema).toContain('top_hash STRING');
                expect(schema).toContain('logical_key STRING');
                expect(schema).toContain('physical_key STRING');
                expect(schema).toContain('multihash STRING');
                expect(schema).toContain('size BIGINT');
                expect(schema).toContain('metadata STRING');
                
                // Schema.sql shows S3 tables should include partitioning but NOT LOCATION clause
                expect(schema).toContain('PARTITIONED BY');
                expect(schema).toContain('registry,');
                expect(schema).toContain('bucket(64, physical_key)');
                
                // Should include S3 Tables specific properties
                expect(schema).toContain("TBLPROPERTIES ('table_type' = 'ICEBERG', 'format' = 'PARQUET')");
                
                // Partitioning clause should be accessible separately
                const partitionClause = table['getPartitioningClause']();
                expect(partitionClause).toContain('PARTITIONED BY (');
                expect(partitionClause).toContain('registry,');
                expect(partitionClause).toContain('bucket(64, physical_key)');
            });
        });
    });

    describe('Glue Tables - CREATE TABLE AS SELECT (CTAS) Operations', () => {
        describe('package_revision Glue CTAS', () => {
            it('should generate correct Glue CTAS query matching schema.sql patterns', () => {
                const table = new PackageRevisionTable(glueConfig);
                const ctas = table['generateCreateQuery']();
                
                expect(ctas).toContain('CREATE TABLE package_revision');
                expect(ctas).toContain('WITH (');
                expect(ctas).toContain("format = 'PARQUET'");
                expect(ctas).toContain("write_compression = 'SNAPPY'");
                expect(ctas).toContain("location = 's3://test-glue-bucket/iceberg_catalog/package_revision'");
                expect(ctas).toContain("table_type = 'ICEBERG'");
                expect(ctas).toContain("is_external = false");
                expect(ctas).toContain('AS SELECT');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS registry');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS pkg_name');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS top_hash');
                expect(ctas).toContain('CAST(NULL AS TIMESTAMP) AS timestamp');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS message');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS metadata');
                expect(ctas).toContain('WHERE 1=0');
            });
        });

        describe('package_tag Glue CTAS', () => {
            it('should generate correct Glue CTAS query matching schema.sql patterns', () => {
                const table = new PackageTagTable(glueConfig);
                const ctas = table['generateCreateQuery']();
                
                expect(ctas).toContain('CREATE TABLE package_tag');
                expect(ctas).toContain('WITH (');
                expect(ctas).toContain("format = 'PARQUET'");
                expect(ctas).toContain("write_compression = 'SNAPPY'");
                expect(ctas).toContain("location = 's3://test-glue-bucket/iceberg_catalog/package_tag'");
                expect(ctas).toContain("table_type = 'ICEBERG'");
                expect(ctas).toContain("is_external = false");
                expect(ctas).toContain('AS SELECT');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS registry');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS pkg_name');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS tag_name');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS top_hash');
                expect(ctas).toContain('WHERE 1=0');
            });
        });

        describe('package_entry Glue CTAS', () => {
            it('should generate correct Glue CTAS query matching schema.sql patterns', () => {
                const table = new PackageEntryTable(glueConfig);
                const ctas = table['generateCreateQuery']();
                
                expect(ctas).toContain('CREATE TABLE package_entry');
                expect(ctas).toContain('WITH (');
                expect(ctas).toContain("format = 'PARQUET'");
                expect(ctas).toContain("write_compression = 'SNAPPY'");
                expect(ctas).toContain("location = 's3://test-glue-bucket/iceberg_catalog/package_entry'");
                expect(ctas).toContain("table_type = 'ICEBERG'");
                expect(ctas).toContain("is_external = false");
                expect(ctas).toContain('AS SELECT');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS registry');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS top_hash');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS logical_key');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS physical_key');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS multihash');
                expect(ctas).toContain('CAST(NULL AS BIGINT) AS size');
                expect(ctas).toContain('CAST(NULL AS VARCHAR) AS metadata');
                expect(ctas).toContain('WHERE 1=0');
            });
        });
    });

    describe('Glue Tables - INSERT Operations', () => {
        it('should generate INSERT SQL for package_revision matching schema.sql patterns', () => {
            const table = new PackageRevisionTable(glueConfig);
            const sql = table.generateInsertQuery(packagesView, objectsView);

            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_revision');
            expect(sql).toContain('registry, pkg_name, top_hash, timestamp, message, metadata');
            expect(sql).toContain("'test-registry' AS registry");
            expect(sql).toContain('s.pkg_name');
            expect(sql).toContain('s.top_hash');
            expect(sql).toContain('from_unixtime(CAST(s.timestamp AS bigint)) AS timestamp');
            expect(sql).toContain('s.message');
            expect(sql).toContain('s.user_meta AS metadata');
            expect(sql).toContain('LEFT JOIN');
            expect(sql).toContain('ON s.pkg_name = t.pkg_name');
            expect(sql).toContain('AND s.top_hash = t.top_hash');
            expect(sql).toContain("AND t.registry = 'test-registry'");
            expect(sql).toContain("WHERE t.pkg_name IS NULL");
            expect(sql).toContain("AND s.timestamp != 'latest'");
        });

        it('should generate INSERT SQL for package_tag matching schema.sql patterns', () => {
            const table = new PackageTagTable(glueConfig);
            const sql = table.generateInsertQuery(packagesView, objectsView);

            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_tag');
            expect(sql).toContain('registry, pkg_name, tag_name, top_hash');
            expect(sql).toContain("'test-registry' AS registry");
            expect(sql).toContain('s.pkg_name');
            expect(sql).toContain('s.timestamp AS tag_name');
            expect(sql).toContain('s.top_hash');
            expect(sql).toContain('LEFT JOIN');
            expect(sql).toContain('ON s.pkg_name = t.pkg_name');
            expect(sql).toContain('AND s.timestamp = t.tag_name');
            expect(sql).toContain("AND t.registry = 'test-registry'");
            expect(sql).toContain("WHERE s.timestamp = 'latest'");
            expect(sql).toContain("AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)");
        });

        it('should generate INSERT SQL for package_entry matching schema.sql patterns', () => {
            const table = new PackageEntryTable(glueConfig);
            const sql = table.generateInsertQuery(packagesView, objectsView);

            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_entry');
            expect(sql).toContain('registry, top_hash, logical_key, physical_key, multihash, size, metadata');
            expect(sql).toContain("'test-registry' AS registry");
            expect(sql).toContain('s.top_hash');
            expect(sql).toContain('s.logical_key');
            expect(sql).toContain('s.physical_key');
            expect(sql).toContain('concat(');
            expect(sql).toContain('CASE s.hash.type');
            expect(sql).toContain("WHEN 'SHA256' THEN '1220'");
            expect(sql).toContain("WHEN 'sha2-256-chunked' THEN 'b150'");
            expect(sql).toContain("ELSE '0000'");
            expect(sql).toContain('s.hash.value');
            expect(sql).toContain('AS multihash');
            expect(sql).toContain('s.size');
            expect(sql).toContain('s.meta AS metadata');
            expect(sql).toContain('LEFT JOIN');
            expect(sql).toContain('ON s.logical_key = t.logical_key');
            expect(sql).toContain('AND s.meta = t.metadata');
            expect(sql).toContain('AND s.top_hash = t.top_hash');
            expect(sql).toContain("AND t.registry = 'test-registry'");
            expect(sql).toContain('WHERE t.logical_key IS NULL');
        });
    });

    describe('DROP TABLE Operations', () => {
        it('should generate correct DROP statements for Glue tables matching schema.sql patterns', () => {
            // Test actual generated DROP statements from Glue config
            const dropRevisionSQL = glueConfig.dropTableQuery('package_revision');
            const dropTagSQL = glueConfig.dropTableQuery('package_tag');
            const dropEntrySQL = glueConfig.dropTableQuery('package_entry');
            
            expect(dropRevisionSQL).toBe('DROP TABLE IF EXISTS package_revision');
            expect(dropTagSQL).toBe('DROP TABLE IF EXISTS package_tag');
            expect(dropEntrySQL).toBe('DROP TABLE IF EXISTS package_entry');
        });

        it('should generate correct DROP statements for S3 tables matching schema.sql patterns', () => {
            // Test actual generated DROP statements from S3 config
            const dropRevisionSQL = s3Config.dropTableQuery('package_revision');
            const dropTagSQL = s3Config.dropTableQuery('package_tag');
            const dropEntrySQL = s3Config.dropTableQuery('package_entry');
            
            expect(dropRevisionSQL).toBe('DROP TABLE IF EXISTS package_revision');
            expect(dropTagSQL).toBe('DROP TABLE IF EXISTS package_tag');
            expect(dropEntrySQL).toBe('DROP TABLE IF EXISTS package_entry');
        });
    });

    describe('Schema Structure Validation', () => {
        it('should have consistent schema between S3 and Glue configurations', () => {
            const s3RevisionTable = new PackageRevisionTable(s3Config);
            const glueRevisionTable = new PackageRevisionTable(glueConfig);
            
            const s3Schema = s3RevisionTable['getColumnDefinitions']();
            const glueSchema = glueRevisionTable['getColumnDefinitions']();
            
            // Core schema should be identical between S3 and Glue
            expect(s3Schema).toEqual(glueSchema);
        });

        it('should validate multihash generation patterns match schema.sql', () => {
            const table = new PackageEntryTable(glueConfig);
            const selectClause = table['generateSelectClause']('test-registry', 's');
            
            // Verify multihash generation matches schema.sql patterns exactly
            expect(selectClause).toContain('concat(');
            expect(selectClause).toContain('CASE s.hash.type');
            expect(selectClause).toContain("WHEN 'SHA256' THEN '1220'");
            expect(selectClause).toContain("WHEN 'sha2-256-chunked' THEN 'b150'");
            expect(selectClause).toContain("ELSE '0000'");
            expect(selectClause).toContain('s.hash.value');
            expect(selectClause).toContain('AS multihash');
        });

        it('should validate source table formatting flexibility', () => {
            // Test that our table classes can handle both generic source tables
            // and specific Quilt source view references like in schema.sql
            const quiltPackagesView = '"AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view"';
            const quiltObjectsView = '"AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_objects-view"';
            
            const table = new PackageRevisionTable(glueConfig);
            const sql = table.generateInsertQuery(quiltPackagesView, quiltObjectsView);
            
            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_revision');
            expect(sql).toContain("'quilt-bake' AS registry");
            expect(sql).toContain('"AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view"');
        });

        it('should validate all tables support proper JOIN conditions for data integrity', () => {
            // package_revision: immutable - only insert new rows based on pkg_name + top_hash combination
            const revisionTable = new PackageRevisionTable(glueConfig);
            const revisionSql = revisionTable.generateInsertQuery(packagesView, objectsView);
            expect(revisionSql).toContain('ON s.pkg_name = t.pkg_name');
            expect(revisionSql).toContain('AND s.top_hash = t.top_hash');
            expect(revisionSql).toContain('WHERE t.pkg_name IS NULL');
            expect(revisionSql).toContain("AND s.timestamp != 'latest'");
            
            // package_tag: mutable - insert or update based on tag/top_hash changes  
            const tagTable = new PackageTagTable(glueConfig);
            const tagSql = tagTable.generateInsertQuery(packagesView, objectsView);
            expect(tagSql).toContain('ON s.pkg_name = t.pkg_name');
            expect(tagSql).toContain('AND s.timestamp = t.tag_name');
            expect(tagSql).toContain("WHERE s.timestamp = 'latest'");
            expect(tagSql).toContain('AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)');
            
            // package_entry: immutable - only insert new rows based on logical_key + metadata + top_hash combination
            const entryTable = new PackageEntryTable(glueConfig);
            const entrySql = entryTable.generateInsertQuery(packagesView, objectsView);
            expect(entrySql).toContain('ON s.logical_key = t.logical_key');
            expect(entrySql).toContain('AND s.meta = t.metadata');
            expect(entrySql).toContain('AND s.top_hash = t.top_hash');
            expect(entrySql).toContain('WHERE t.logical_key IS NULL');
        });
    });

    describe('CREATE and DROP TABLE Operations', () => {
        it('should generate CREATE TABLE SQL', () => {
            const table = new PackageRevisionTable(s3Config);
            const sql = table.query('create');
            
            expect(sql).toContain('CREATE TABLE');
            expect(sql).toContain('package_revision');
            expect(sql).toContain('registry STRING');
            expect(sql).toContain('pkg_name STRING');
        });

        it('should generate DROP TABLE SQL', () => {
            const table = new PackageRevisionTable(s3Config);
            const sql = table.query('drop');
            
            expect(sql).toBe('DROP TABLE IF EXISTS preview.package_revision');
        });
    });
});
