import { executeQuery, tableExists } from "../shared/athena-utils";
import { TableContext } from "../shared/types";

/**
 * Abstract base class for Iceberg table operations
 * Provides common functionality for table creation and data insertion
 */
export abstract class BaseTable {
    // Abstract properties that subclasses must implement
    protected abstract get tableName(): string;
    protected abstract getCreateTableSchema(databaseName: string): string;
    protected abstract getPartitioningClause(): string;
    protected abstract generateInsertQuery(context: TableContext, sourceTableName: string): string;
    
    // New abstract methods for cleaner CTAS generation
    protected abstract generateSelectClause(registryName: string, sourceAlias: string): string;
    protected abstract generateWhereClauseForCtas(sourceAlias: string): string;

    /**
     * Ensure table exists using appropriate strategy based on table type
     * S3 tables: CREATE empty table with partitions
     * Iceberg tables: CTAS (CREATE TABLE AS SELECT) with initial data
     */
    static async ensureExists(
        databaseName: string,
        targetBucket: string,
        sourceView: string,
        useS3Table?: boolean
    ): Promise<void> {
        const instance = new (this as any)();
        
        if (await tableExists(databaseName, instance.tableName)) {
            return;
        }

        const shouldUseS3Table = useS3Table || false;
        
        if (shouldUseS3Table) {
            // S3 table: create empty table with partitions
            console.log(`Creating ${instance.tableName} S3 table (empty, partitioned)`);
            await instance.createEmptyTable(databaseName, targetBucket, true);
        } else {
            // Iceberg table: use CTAS to create with initial data
            console.log(`Creating ${instance.tableName} Iceberg table using CTAS`);
            await instance.createTableAsSelect(databaseName, targetBucket, sourceView);
        }
    }

    /**
     * Create an empty table with the schema defined by the subclass (for S3 tables)
     */
    private async createEmptyTable(
        databaseName: string,
        targetBucket: string,
        useS3Table: boolean
    ): Promise<void> {
        const createQuery = this.getCompleteCreateTableSchema(databaseName, targetBucket, useS3Table);
        console.log(`Creating empty ${this.tableName} table with SQL:`, createQuery);
        await executeQuery(createQuery, targetBucket, databaseName, useS3Table);
    }

    /**
     * Create table using CTAS (CREATE TABLE AS SELECT) for Iceberg tables
     */
    private async createTableAsSelect(
        databaseName: string,
        targetBucket: string,
        sourceView: string
    ): Promise<void> {
        const ctasQuery = this.generateCtasQuery(databaseName, targetBucket, sourceView);
        console.log(`Creating ${this.tableName} table with CTAS:`, ctasQuery);
        await executeQuery(ctasQuery, targetBucket, databaseName, false); // CTAS is always for Iceberg
    }

    /**
     * Generate CTAS query for Iceberg tables
     */
    protected generateCtasQuery(databaseName: string, targetBucket: string, sourceView: string): string {
        const withClause = this.getWithClause(targetBucket);
        const selectQuery = this.generateSelectForCtas(databaseName, sourceView);
        
        return `CREATE TABLE "${databaseName}"."${this.tableName}"${withClause}
AS ${selectQuery}`;
    }

    /**
     * Generate the SELECT portion for CTAS using dedicated methods
     */
    protected generateSelectForCtas(databaseName: string, sourceView: string): string {
        const registryName = this.extractRegistryFromSourceView(sourceView);
        const sourceAlias = 's';
        
        const selectClause = this.generateSelectClause(registryName, sourceAlias);
        const whereClause = this.generateWhereClauseForCtas(sourceAlias);
        
        let query = `SELECT DISTINCT ${selectClause} FROM "${databaseName}"."${sourceView}" ${sourceAlias}`;
        
        if (whereClause) {
            query += ` WHERE ${whereClause}`;
        }
        
        return query;
    }

    /**
     * Extract registry name from source view name
     */
    private extractRegistryFromSourceView(sourceView: string): string {
        // Extract registry from source view name (e.g., "bucket_name_packages-view" -> "bucket_name")
        const match = sourceView.match(/^(.+?)_(?:packages|objects)-view$/);
        return match ? match[1] : sourceView;
    }

    /**
     * Generate the complete CREATE TABLE schema with conditional partitioning and WITH clause
     * useS3Table=true: S3 table with partitions, no WITH clause
     * useS3Table=false: Iceberg table with WITH clause, no partitions
     */
    protected getCompleteCreateTableSchema(databaseName: string, targetBucket: string, useS3Table?: boolean): string {
        const baseSchema = this.getCreateTableSchema(databaseName);
        const partitioningClause = this.getPartitioningClause();
        
        // Check runtime configuration, defaulting to false (Iceberg)
        const shouldUseS3Table = useS3Table || false;
        
        let completeSchema = baseSchema.trim();
        
        if (shouldUseS3Table && partitioningClause) {
            // S3 table: add partitioning, no WITH clause
            completeSchema += `\n            ${partitioningClause}`;
        } else {
            // Iceberg table: add WITH clause, no partitioning
            completeSchema += this.getWithClause(targetBucket);
        }
        
        return completeSchema;
    }

    /**
     * Generate the WITH clause for Iceberg table properties
     */
    protected getWithClause(targetBucket: string): string {
        return `
            WITH (
                format = 'PARQUET',
                write_compression = 'SNAPPY',
                location = 's3://${targetBucket}/iceberg_catalog/${this.tableName}/',
                table_type = 'ICEBERG',
                is_external = false
            )`;
    }

    /**
     * Insert data into the table using the query generated by the subclass
     */
    static async insert(context: TableContext, sourceTableName: string): Promise<void> {
        const instance = new (this as any)();
        const query = instance.generateInsertQuery(context, sourceTableName);
        console.log(`Inserting into ${instance.tableName} with SQL:`, query);
        await executeQuery(query, context.targetBucket, context.targetDatabaseName, context.useS3Table);
    }

    /**
     * Generate the static insert query (for backward compatibility)
     */
    static generateInsertQuery(context: TableContext, sourceTableName: string): string {
        const instance = new (this as any)();
        return instance.generateInsertQuery(context, sourceTableName);
    }
}
