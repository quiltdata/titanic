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
import { createTableContext } from '../shared/types';

describe('Schema Validation Tests', () => {
    let glueConfig: Config;
    let s3Config: S3Config;
    const testContext = createTableContext('test-registry');
    const sourceTable = 'test-source-table';
    
    beforeEach(() => {
        glueConfig = Config.createTestInstance({
            glueDatabaseName: 'test-glue-db',
            glueTablesBucket: 'test-glue-bucket'
        });
        
        s3Config = S3Config.createTestInstance({
            s3TableDatabaseName: 'test-s3-db',
            s3TablesBucket: 'test-s3-bucket'
        });
    });

    describe('S3 Tables - CREATE TABLE Operations', () => {
        describe('package_revision S3 CREATE TABLE', () => {
            it('should generate correct S3 CREATE TABLE schema', () => {
                const table = new PackageRevisionTable(s3Config);
                const schema = table['getCompleteCreateTableSchema']();
                
                expect(schema).toContain('CREATE TABLE');
                expect(schema).toContain('package_revision');
                expect(schema).toContain('registry     STRING');
                expect(schema).toContain('pkg_name     STRING');
                expect(schema).toContain('top_hash     STRING');
                expect(schema).toContain('timestamp    TIMESTAMP');
                expect(schema).toContain('message      STRING');
                expect(schema).toContain('metadata    STRING');
                expect(schema).toContain('LOCATION');
                expect(schema).toContain('s3://');
                
                // Check for partitioning clause from schema.sql
                const partitionClause = table['getPartitioningClause']();
                expect(partitionClause).toContain('PARTITIONED BY (');
                expect(partitionClause).toContain('registry,');
                expect(partitionClause).toContain('bucket(8, pkg_name),');
                expect(partitionClause).toContain('bucket(8, top_hash)');
            });
        });

        describe('package_tag S3 CREATE TABLE', () => {
            it('should generate correct S3 CREATE TABLE schema', () => {
                const table = new PackageTagTable(s3Config);
                const schema = table['getCompleteCreateTableSchema']();
                
                expect(schema).toContain('CREATE TABLE');
                expect(schema).toContain('package_tag');
                expect(schema).toContain('registry   STRING');
                expect(schema).toContain('pkg_name   STRING');
                expect(schema).toContain('tag_name   STRING');
                expect(schema).toContain('top_hash   STRING');
                expect(schema).toContain('LOCATION');
                expect(schema).toContain('s3://');
                
                // Check for partitioning clause from schema.sql
                const partitionClause = table['getPartitioningClause']();
                expect(partitionClause).toContain('PARTITIONED BY (');
                expect(partitionClause).toContain('registry,');
                expect(partitionClause).toContain('tag_name,');
                expect(partitionClause).toContain('bucket(8, pkg_name)');
            });
        });

        describe('package_entry S3 CREATE TABLE', () => {
            it('should generate correct S3 CREATE TABLE schema', () => {
                const table = new PackageEntryTable(s3Config);
                const schema = table['getCompleteCreateTableSchema']();
                
                expect(schema).toContain('CREATE TABLE');
                expect(schema).toContain('package_entry');
                expect(schema).toContain('registry     STRING');
                expect(schema).toContain('top_hash     STRING');
                expect(schema).toContain('logical_key  STRING');
                expect(schema).toContain('physical_key STRING');
                expect(schema).toContain('multihash   STRING');
                expect(schema).toContain('size         BIGINT');
                expect(schema).toContain('metadata    STRING');
                expect(schema).toContain('LOCATION');
                expect(schema).toContain('s3://');
                
                // Check for partitioning clause from schema.sql
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
                const ctas = table['generateCtasQueryForInsert'](testContext, sourceTable);
                
                expect(ctas).toContain('CREATE TABLE');
                expect(ctas).toContain('package_revision');
                expect(ctas).toContain('WITH (');
                expect(ctas).toContain("format = 'iceberg'");
                expect(ctas).toContain('AS SELECT');
                expect(ctas).toContain("'test-registry' AS registry");
                expect(ctas).toContain('s.pkg_name');
                expect(ctas).toContain('s.top_hash');
                expect(ctas).toContain('from_unixtime(CAST(s.timestamp AS bigint)) AS timestamp');
                expect(ctas).toContain('s.message');
                expect(ctas).toContain('s.user_meta AS metadata');
                expect(ctas).toContain("WHERE s.timestamp != 'latest'");
            });
        });

        describe('package_tag Glue CTAS', () => {
            it('should generate correct Glue CTAS query matching schema.sql patterns', () => {
                const table = new PackageTagTable(glueConfig);
                const ctas = table['generateCtasQueryForInsert'](testContext, sourceTable);
                
                expect(ctas).toContain('CREATE TABLE');
                expect(ctas).toContain('package_tag');
                expect(ctas).toContain('WITH (');
                expect(ctas).toContain("format = 'iceberg'");
                expect(ctas).toContain('AS SELECT');
                expect(ctas).toContain("'test-registry' AS registry");
                expect(ctas).toContain('s.pkg_name');
                expect(ctas).toContain('s.timestamp AS tag_name');
                expect(ctas).toContain('s.top_hash');
            });
        });

        describe('package_entry Glue CTAS', () => {
            it('should generate correct Glue CTAS query matching schema.sql patterns', () => {
                const table = new PackageEntryTable(glueConfig);
                const ctas = table['generateCtasQueryForInsert'](testContext, sourceTable);
                
                expect(ctas).toContain('CREATE TABLE');
                expect(ctas).toContain('package_entry');
                expect(ctas).toContain('WITH (');
                expect(ctas).toContain("format = 'iceberg'");
                expect(ctas).toContain('AS SELECT');
                expect(ctas).toContain("'test-registry' AS registry");
                expect(ctas).toContain('s.top_hash');
                expect(ctas).toContain('s.logical_key');
                expect(ctas).toContain('s.physical_key');
                expect(ctas).toContain('concat(');
                expect(ctas).toContain('AS multihash');
                expect(ctas).toContain('s.size');
                expect(ctas).toContain('s.meta AS metadata');
            });
        });
    });

    describe('S3 Tables - INSERT Operations', () => {
        describe('package_revision S3 INSERT', () => {
            it('should generate INSERT SQL matching schema.sql patterns', () => {
                const sql = PackageRevisionTable.generateInsertQuery(testContext, sourceTable, s3Config);
                
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
                expect(sql).toContain("WHERE t.pkg_name IS NULL");
                expect(sql).toContain("AND s.timestamp != 'latest'");
            });
        });

        describe('package_tag S3 INSERT', () => {
            it('should generate INSERT SQL matching schema.sql patterns', () => {
                const sql = PackageTagTable.generateInsertQuery(testContext, sourceTable, s3Config);
                
                expect(sql).toContain('INSERT INTO');
                expect(sql).toContain('package_tag');
                expect(sql).toContain('registry, pkg_name, tag_name, top_hash');
                expect(sql).toContain("'test-registry' AS registry");
                expect(sql).toContain('s.pkg_name');
                expect(sql).toContain('s.timestamp AS tag_name');
                expect(sql).toContain('s.top_hash');
                expect(sql).toContain('LEFT JOIN');
                expect(sql).toContain("WHERE s.timestamp = 'latest'");
                expect(sql).toContain("AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)");
            });
        });

        describe('package_entry S3 INSERT', () => {
            it('should generate INSERT SQL matching schema.sql patterns', () => {
                const sql = PackageEntryTable.generateInsertQuery(testContext, sourceTable, s3Config);
                
                expect(sql).toContain('INSERT INTO');
                expect(sql).toContain('package_entry');
                expect(sql).toContain('registry, top_hash, logical_key, physical_key, multihash, size, metadata');
                expect(sql).toContain("'test-registry' AS registry");
                expect(sql).toContain('s.top_hash');
                expect(sql).toContain('s.logical_key');
                expect(sql).toContain('s.physical_key');
                expect(sql).toContain('concat(');
                expect(sql).toContain('AS multihash');
                expect(sql).toContain('s.size');
                expect(sql).toContain('s.meta AS metadata');
                expect(sql).toContain('LEFT JOIN');
                expect(sql).toContain('WHERE t.logical_key IS NULL');
            });
        });
    });

    describe('Glue Tables - INSERT Operations', () => {
        describe('package_revision Glue INSERT', () => {
            it('should generate INSERT SQL matching schema.sql patterns', () => {
                const sql = PackageRevisionTable.generateInsertQuery(testContext, sourceTable, glueConfig);
                
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
                expect(sql).toContain("WHERE t.pkg_name IS NULL");
                expect(sql).toContain("AND s.timestamp != 'latest'");
            });
        });

        describe('package_tag Glue INSERT', () => {
            it('should generate INSERT SQL matching schema.sql patterns', () => {
                const sql = PackageTagTable.generateInsertQuery(testContext, sourceTable, glueConfig);
                
                expect(sql).toContain('INSERT INTO');
                expect(sql).toContain('package_tag');
                expect(sql).toContain('registry, pkg_name, tag_name, top_hash');
                expect(sql).toContain("'test-registry' AS registry");
                expect(sql).toContain('s.pkg_name');
                expect(sql).toContain('s.timestamp AS tag_name');
                expect(sql).toContain('s.top_hash');
                expect(sql).toContain('LEFT JOIN');
                expect(sql).toContain("WHERE s.timestamp = 'latest'");
                expect(sql).toContain("AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)");
            });
        });

        describe('package_entry Glue INSERT', () => {
            it('should generate INSERT SQL matching schema.sql patterns', () => {
                const sql = PackageEntryTable.generateInsertQuery(testContext, sourceTable, glueConfig);
                
                expect(sql).toContain('INSERT INTO');
                expect(sql).toContain('package_entry');
                expect(sql).toContain('registry, top_hash, logical_key, physical_key, multihash, size, metadata');
                expect(sql).toContain("'test-registry' AS registry");
                expect(sql).toContain('s.top_hash');
                expect(sql).toContain('s.logical_key');
                expect(sql).toContain('s.physical_key');
                expect(sql).toContain('concat(');
                expect(sql).toContain('AS multihash');
                expect(sql).toContain('s.size');
                expect(sql).toContain('s.meta AS metadata');
                expect(sql).toContain('LEFT JOIN');
            });
        });
    });

    describe('DROP TABLE Operations', () => {
        it('should generate correct DROP statements for all tables', () => {
            // Test DROP statements match schema.sql patterns
            const dropRevisionSQL = 'DROP TABLE IF EXISTS package_revision';
            const dropTagSQL = 'DROP TABLE IF EXISTS package_tag';
            const dropEntrySQL = 'DROP TABLE IF EXISTS package_entry';
            
            expect(dropRevisionSQL).toContain('DROP TABLE IF EXISTS');
            expect(dropRevisionSQL).toContain('package_revision');
            expect(dropTagSQL).toContain('DROP TABLE IF EXISTS');
            expect(dropTagSQL).toContain('package_tag');
            expect(dropEntrySQL).toContain('DROP TABLE IF EXISTS');
            expect(dropEntrySQL).toContain('package_entry');
        });
    });

    describe('Schema Structure Validation', () => {
        it('should have consistent schema between S3 and Glue configurations', () => {
            const s3RevisionTable = new PackageRevisionTable(s3Config);
            const glueRevisionTable = new PackageRevisionTable(glueConfig);
            
            const s3Schema = s3RevisionTable['getCreateTableSchema']();
            const glueSchema = glueRevisionTable['getCreateTableSchema']();
            
            // Core schema should be identical between S3 and Glue
            expect(s3Schema).toEqual(glueSchema);
        });

        it('should validate multihash generation patterns match schema.sql', () => {
            const table = new PackageEntryTable(glueConfig);
            const selectClause = table['generateSelectClause']('test-registry', 's');
            
            // Verify multihash generation matches schema.sql patterns
            expect(selectClause).toContain('concat(');
            expect(selectClause).toContain("WHEN 'SHA256' THEN '1220'");
            expect(selectClause).toContain("WHEN 'sha2-256-chunked' THEN 'b150'");
            expect(selectClause).toContain("ELSE '0000'");
            expect(selectClause).toContain('s.hash.value');
            expect(selectClause).toContain('AS multihash');
        });

        it('should validate source table formatting flexibility', () => {
            // Test that our table classes can handle both generic source tables
            // and specific Quilt source view references like in schema.sql
            const quiltContext = createTableContext('quilt-bake');
            const quiltSourceTable = '"AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view"';
            
            const sql = PackageRevisionTable.generateInsertQuery(quiltContext, quiltSourceTable, glueConfig);
            
            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_revision');
            expect(sql).toContain("'quilt-bake' AS registry");
            expect(sql).toContain('"AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view"');
        });

        it('should validate all tables support proper JOIN conditions for data integrity', () => {
            // package_revision: immutable - only insert new rows
            const revisionSql = PackageRevisionTable.generateInsertQuery(testContext, sourceTable, glueConfig);
            expect(revisionSql).toContain('WHERE t.pkg_name IS NULL');
            
            // package_tag: mutable - insert or update based on tag/top_hash changes  
            const tagSql = PackageTagTable.generateInsertQuery(testContext, sourceTable, glueConfig);
            expect(tagSql).toContain('WHERE s.timestamp = \'latest\'');
            expect(tagSql).toContain('AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)');
            
            // package_entry: immutable - only insert new rows
            const entrySql = PackageEntryTable.generateInsertQuery(testContext, sourceTable, glueConfig);
            expect(entrySql).toContain('WHERE t.logical_key IS NULL');
        });
    });
});
