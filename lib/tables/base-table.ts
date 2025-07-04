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


    /*
    * Generate a list of columns in the specified pattern
    * Example pattern: "${name} ${type}"
    */
    protected generateColumnList(pattern: string): string {
        const columns = this.getColumnDefinitions();
        const entries = Object.entries(columns);
        return entries.map(([name, type]) => pattern.replace(/\${name}/g, name).replace(/\${type}/g, type)).join(', ');
    }

    /**
     * Generate CTAS query for empty table creation (mainly for tests)
     */
    public generateCreateQuery() {

        if (this.config.useS3Table) {
            // For S3 tables, use CREATE TABLE with partitioning (no LOCATION)
            const columnDefs = this.generateColumnList("${name} ${type}");
            const partitioning = this.getPartitioningClause();
            return `CREATE TABLE ${this.tableName} (${columnDefs}) ${partitioning}`;
        } else {
            // For Glue tables, generate CTAS with CAST(NULL AS ...) for each column
            const selectColumns = this.generateColumnList("CAST(NULL AS ${type}) AS ${name}");

            return `CREATE TABLE ${this.tableName} WITH (
                format = 'PARQUET',
                write_compression = 'SNAPPY',
                location = 's3://${this.config.getTargetBucket()}/iceberg_catalog/${this.tableName}',
                table_type = 'ICEBERG',
                is_external = false
            ) AS SELECT ${selectColumns} WHERE 1=0`;
        }
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
