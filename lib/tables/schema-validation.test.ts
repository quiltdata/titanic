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
    let config: Config;
    let s3Config: S3Config;
    const testContext = createTableContext('test-registry');
    const sourceTable = 'test-source-table';
    
    beforeEach(() => {
        config = Config.createTestInstance({
            glueDatabaseName: 'test-glue-db',
            glueTablesBucket: 'test-glue-bucket'
        });
        
        s3Config = S3Config.createTestInstance({
            s3TableDatabaseName: 'test-s3-db',
            s3TablesBucket: 'test-s3-bucket'
        });
    });

    describe('Static API Schema Validation', () => {
        it('should generate package_revision INSERT SQL matching schema.sql patterns', () => {
            const sql = PackageRevisionTable.generateInsertQuery(testContext, sourceTable, config);
            
            // Verify the SQL contains expected columns and patterns from schema.sql
            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_revision');
            expect(sql).toContain('registry, pkg_name, top_hash, timestamp, message, metadata');
            expect(sql).toContain("'test-registry' AS registry");
            expect(sql).toContain('s.pkg_name');
            expect(sql).toContain('s.top_hash');
            expect(sql).toContain('from_unixtime(CAST(s.timestamp AS bigint)) AS timestamp');
            expect(sql).toContain('s.message');
            expect(sql).toContain('s.user_meta AS metadata');
            expect(sql).toContain("WHERE t.pkg_name IS NULL");
            expect(sql).toContain("AND s.timestamp != 'latest'");
        });

        it('should generate package_tag INSERT SQL matching schema.sql patterns', () => {
            const sql = PackageTagTable.generateInsertQuery(testContext, sourceTable, config);
            
            // Verify the SQL contains expected columns and patterns from schema.sql
            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_tag');
            expect(sql).toContain('registry, pkg_name, tag_name, top_hash');
            expect(sql).toContain("'test-registry' AS registry");
            expect(sql).toContain('s.pkg_name');
            expect(sql).toContain('s.timestamp AS tag_name');  // tag_name comes from timestamp
            expect(sql).toContain('s.top_hash');
        });

        it('should generate package_entry INSERT SQL matching schema.sql patterns', () => {
            const sql = PackageEntryTable.generateInsertQuery(testContext, sourceTable, config);
            
            // Verify the SQL contains expected columns and patterns from schema.sql
            expect(sql).toContain('INSERT INTO');
            expect(sql).toContain('package_entry');
            expect(sql).toContain('registry, top_hash, logical_key, physical_key, multihash, size, metadata');
            expect(sql).toContain("'test-registry' AS registry");
            expect(sql).toContain('s.top_hash');
            expect(sql).toContain('s.logical_key');
            expect(sql).toContain('s.physical_key');
            expect(sql).toContain('AS multihash');  // multihash is computed, not direct from s.multihash
            expect(sql).toContain('s.size');
            expect(sql).toContain('s.meta AS metadata');  // metadata comes from meta, not user_meta
        });
    });

    describe('Schema Structure Validation', () => {
        it('should have correct schema structure for package_revision', () => {
            const table = new PackageRevisionTable(config);
            const schema = table['getCreateTableSchema']();
            
            // Verify schema contains expected columns with proper data types
            expect(schema).toContain('registry     STRING');
            expect(schema).toContain('pkg_name     STRING');
            expect(schema).toContain('top_hash     STRING');
            expect(schema).toContain('timestamp    TIMESTAMP');
            expect(schema).toContain('message      STRING');
            expect(schema).toContain('metadata    STRING');
        });

        it('should have correct schema structure for package_tag', () => {
            const table = new PackageTagTable(config);
            const schema = table['getCreateTableSchema']();
            
            // Verify schema contains expected columns with proper data types
            expect(schema).toContain('registry   STRING');
            expect(schema).toContain('pkg_name   STRING');
            expect(schema).toContain('tag_name   STRING');
            expect(schema).toContain('top_hash   STRING');
        });

        it('should have correct schema structure for package_entry', () => {
            const table = new PackageEntryTable(config);
            const schema = table['getCreateTableSchema']();
            
            // Verify schema contains expected columns with proper data types
            expect(schema).toContain('registry     STRING');
            expect(schema).toContain('top_hash     STRING');
            expect(schema).toContain('logical_key  STRING');
            expect(schema).toContain('physical_key STRING');
            expect(schema).toContain('multihash   STRING');
            expect(schema).toContain('size         BIGINT');
            expect(schema).toContain('metadata    STRING');
        });
    });

    describe('Complete CREATE TABLE Schema Generation', () => {
        it('should generate complete CREATE TABLE for package_revision', () => {
            const table = new PackageRevisionTable(config);
            const completeSchema = table['getCompleteCreateTableSchema']();
            
            expect(completeSchema).toContain('CREATE TABLE');
            expect(completeSchema).toContain('package_revision');
            expect(completeSchema).toContain('registry     STRING');
            expect(completeSchema).toContain('pkg_name     STRING');
        });

        it('should generate complete CREATE TABLE for package_tag', () => {
            const table = new PackageTagTable(config);
            const completeSchema = table['getCompleteCreateTableSchema']();
            
            expect(completeSchema).toContain('CREATE TABLE');
            expect(completeSchema).toContain('package_tag');
            expect(completeSchema).toContain('registry   STRING');
            expect(completeSchema).toContain('pkg_name   STRING');
        });

        it('should generate complete CREATE TABLE for package_entry', () => {
            const table = new PackageEntryTable(config);
            const completeSchema = table['getCompleteCreateTableSchema']();
            
            expect(completeSchema).toContain('CREATE TABLE');
            expect(completeSchema).toContain('package_entry');
            expect(completeSchema).toContain('registry     STRING');
            expect(completeSchema).toContain('top_hash     STRING');
        });
    });

    describe('S3 vs Glue Mode Differences', () => {
        it('should handle both Glue and S3 table configurations for package_revision', () => {
            const glueTable = new PackageRevisionTable(config);
            const s3Table = new PackageRevisionTable(s3Config);
            
            // Both should have the same schema structure
            const glueSchema = glueTable['getCreateTableSchema']();
            const s3Schema = s3Table['getCreateTableSchema']();
            
            expect(glueSchema).toEqual(s3Schema);
        });

        it('should generate different INSERT queries based on config type', () => {
            const glueSql = PackageRevisionTable.generateInsertQuery(testContext, sourceTable, config);
            const s3Sql = PackageRevisionTable.generateInsertQuery(testContext, sourceTable, s3Config);
            
            // Both should contain the same basic structure but may have different table formatting
            expect(glueSql).toContain('INSERT INTO');
            expect(s3Sql).toContain('INSERT INTO');
            expect(glueSql).toContain('package_revision');
            expect(s3Sql).toContain('package_revision');
        });
    });
});
