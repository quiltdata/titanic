import { ColumnDefinitions } from "../shared/types";
import { Config } from "../shared/config";

/**
 * Abstract base class for table operations
 * Provides common functionality for table creation and data insertion
 * Uses the new Config architecture to handle both Glue and S3 table strategies
 */
export abstract class BaseTable {
    protected readonly config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    // Abstract properties that subclasses must implement
    public abstract get tableName(): string;
    protected abstract getColumnDefinitions(): ColumnDefinitions;
    protected abstract getPartitioningClause(): string;
    protected abstract generateInsertQuery(packagesView: string, objectsView: string): string;

    // New abstract methods for cleaner CTAS generation
    protected abstract generateSelectClause(registryName: string, sourceAlias: string): string;
    protected abstract generateWhereClauseForCtas(sourceAlias: string): string;


    /**
     * Generate a list of columns in the specified pattern
     * Example pattern: "${name} ${type}"
     */
    protected generateColumnList(pattern: string): string {
        if (!pattern || pattern.trim() === '') {
            throw new Error('Pattern cannot be empty');
        }

        const columns = this.getColumnDefinitions();
        if (!columns || Object.keys(columns).length === 0) {
            throw new Error('No column definitions found');
        }

        const entries = Object.entries(columns);
        return entries.map(([name, type]) => {
            if (!name || !type) {
                throw new Error(`Invalid column definition: name='${name}', type='${type}'`);
            }
            return pattern.replace(/\${name}/g, name).replace(/\${type}/g, type);
        }).join(', ');
    }

    /**
     * Generate CTAS query for empty table creation (mainly for tests)
     */
    public generateCreateQuery(): string {
        if (this.config.useS3Table) {
            return this.generateS3TableCreateQuery();
        } else {
            return this.generateGlueTableCreateQuery();
        }
    }

    /**
     * Generate CREATE TABLE query for S3 tables
     */
    private generateS3TableCreateQuery(): string {
        const columnDefs = this.generateColumnList("${name} ${type}");
        const partitioning = this.getPartitioningClause();
        return `CREATE TABLE ${this.tableName} (${columnDefs}) ${partitioning}`;
    }

    /**
     * Generate CTAS query for Glue tables
     */
    private generateGlueTableCreateQuery(): string {
        const selectColumns = this.generateColumnList("CAST(NULL AS ${type}) AS ${name}");
        const targetBucket = this.config.getTargetBucket();
        
        if (!targetBucket) {
            throw new Error('Target bucket is required for Glue table creation');
        }

        return `CREATE TABLE ${this.tableName} WITH (
            format = 'PARQUET',
            write_compression = 'SNAPPY',
            location = 's3://${targetBucket}/iceberg_catalog/${this.tableName}',
            table_type = 'ICEBERG',
            is_external = false
        ) AS SELECT ${selectColumns} WHERE 1=0`;
    }

    /**
     * Generate a query of the specified type
     */
    query(type: 'create' | 'insert' | 'drop', packagesView?: string, objectsView?: string): string {
        switch (type) {
            case 'create':
                return this.generateCreateQuery();
            case 'insert':
                if (!packagesView && !objectsView) {
                    throw new Error('At least one of packagesView or objectsView is required for insert queries');
                }
                return this.generateInsertQuery(packagesView || '', objectsView || '');
            case 'drop':
                return `DROP TABLE IF EXISTS ${this.tableName}`;
            default:
                throw new Error(`Unsupported query type: ${type}`);
        }
    }

}
