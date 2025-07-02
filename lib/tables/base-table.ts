import { AthenaUtils } from "../shared/athena-utils";
import { TableContext, ColumnDefinitions } from "../shared/types";
import { Config, S3Config } from "../shared/config";

/**
 * Abstract base class for table operations
 * Provides common functionality for table creation and data insertion
 * Uses the new Config architecture to handle both Glue and S3 table strategies
 */
export abstract class BaseTable {
    protected readonly config: Config;
    protected readonly athenaUtils: AthenaUtils;
    
    constructor(config: Config, athenaUtils?: AthenaUtils) {
        this.config = config;
        this.athenaUtils = athenaUtils || new AthenaUtils(config);
    }
    
    // Abstract properties that subclasses must implement
    protected abstract get tableName(): string;
    protected abstract getColumnDefinitions(): ColumnDefinitions;
    protected abstract getPartitioningClause(): string;
    protected abstract generateInsertQuery(context: TableContext, sourceTableName: string): string;
    
    // New abstract methods for cleaner CTAS generation
    protected abstract generateSelectClause(registryName: string, sourceAlias: string): string;
    protected abstract generateWhereClauseForCtas(sourceAlias: string): string;

    /**
     * Ensure table exists using appropriate strategy based on config type
     * This method is focused solely on table creation and is independent of table dropping.
     * 
     * S3Config: CREATE empty table with partitions immediately
     * Config (Glue): Skip creation (will be created lazily before first INSERT)
     */
    static async ensureExists(
        config: Config,
        sourceView: string,
        athenaUtils?: AthenaUtils
    ): Promise<void> {
        const instance = new (this as any)(config, athenaUtils);
        
        if (await instance.athenaUtils.tableExists(instance.tableName)) {
            return;
        }

        if (config.useS3Table) {
            // S3 table: create empty table with partitions immediately
            console.log(`Creating ${instance.tableName} S3 table (empty, partitioned)`);
            await instance.createEmptyTable();
        } else {
            // Glue table: skip creation - will be created lazily before first INSERT
            console.log(`Skipping ${instance.tableName} Glue table creation (will be created lazily)`);
        }
    }

    /**
     * Generate CTAS query for empty table creation (mainly for tests)
     */
    protected generateCtasQuery() {
        const columns = this.getColumnDefinitions();
        
        if (this.config.useS3Table) {
            // For S3 tables, use CREATE TABLE with partitioning (no LOCATION)
            const columnDefs = Object.entries(columns)
                .map(([name, type]) => `${name} ${type}`)
                .join(', ');
            const tableName = this.config.formatTableName(this.tableName, true);
            const partitioning = this.getPartitioningClause();
            return `
      CREATE TABLE ${tableName} (
        ${columnDefs}
      ) ${partitioning}
    `;
        } else {
            // For Glue tables, generate CTAS with CAST(NULL AS ...) for each column
            const selectColumns = Object.entries(columns)
                .map(([name, type]) => `CAST(NULL AS ${type}) AS ${name}`)
                .join(', ');

            return `CREATE TABLE ${this.tableName} WITH (
                format = 'PARQUET',
                write_compression = 'SNAPPY',
                location = 's3://${this.config.getTablesBucket()}/iceberg_catalog/${this.tableName}',
                table_type = 'ICEBERG',
                is_external = false
            ) AS SELECT ${selectColumns} WHERE 1=0`;
        }
    }

    /**
     * Create table using CTAS for first-time insertion (Glue tables only)
     */
    protected async createTableAsSelectForInsert(context: TableContext, sourceTableName: string): Promise<void> {
        const selectClause = this.generateSelectForInsert(context, sourceTableName);
        
        const ctasQuery = `CREATE TABLE ${this.tableName} WITH (
            format = 'PARQUET',
            write_compression = 'SNAPPY',
            location = 's3://${this.config.getTablesBucket()}/iceberg_catalog/${this.tableName}',
            table_type = 'ICEBERG',
            is_external = false
        ) AS ${selectClause}`;
        
        console.log(`Creating ${this.tableName} with CTAS:`, ctasQuery);
        await this.athenaUtils.executeQuery(ctasQuery);
    }

    /**
     * Create empty table (S3 tables)
     */
    protected async createEmptyTable(): Promise<void> {
        const createQuery = this.generateCtasQuery();
        console.log(`Creating empty ${this.tableName}:`, createQuery);
        await this.athenaUtils.executeQuery(createQuery);
    }
    
    protected generateSelectForInsert(context: TableContext, sourceTableName: string): string {
        const sourceAlias = 's';
        
        const selectClause = this.generateSelectClause(context.registryName, sourceAlias);
        const whereClause = this.generateWhereClauseForCtas(sourceAlias);
        
        // Use config to format table names properly
        const formattedSourceTable = this.config.formatTableName(sourceTableName);
        
        let query = `SELECT DISTINCT ${selectClause} FROM ${formattedSourceTable} ${sourceAlias}`;
        
        if (whereClause) {
            query += ` WHERE ${whereClause}`;
        }
        
        return query;
    }

    /**
     * Generate the complete CREATE TABLE schema using the new Config architecture
     */
    protected getCompleteCreateTableSchema(): string {
        const columns = this.getColumnDefinitions();
        const columnDefs = Object.entries(columns)
            .map(([name, type]) => `${name} ${type}`)
            .join(', ');
        
        if (this.config.useS3Table) {
            // For S3 tables, include partitioning clause
            const tableName = this.config.formatTableName(this.tableName, true);
            const partitioning = this.getPartitioningClause();
            return `
      CREATE TABLE ${tableName} (
        ${columnDefs}
      ) ${partitioning}
    `;
        } else {
            // For Glue tables, use config's createTableQuery (no partitioning)
            return this.config.createTableQuery(this.tableName, columnDefs);
        }
    }

    /**
     * Insert data into the table using the query generated by the subclass
     * For Glue tables: Create table using CTAS if it doesn't exist, then mark creation as done
     * For S3 tables: Use regular INSERT (table should already exist)
     */
    static async insert(context: TableContext, sourceTableName: string, config: Config, athenaUtils?: AthenaUtils): Promise<void> {
        const instance = new (this as any)(config, athenaUtils);
        
        // Check if we need to create the table lazily (Glue tables)
        if (!config.useS3Table) {
            // Check if table exists - if not, create it using CTAS
            if (!(await instance.athenaUtils.tableExists(instance.tableName))) {
                console.log(`Creating ${instance.tableName} Glue table using CTAS on first run`);
                await instance.createTableAsSelectForInsert(context, sourceTableName);
                return; // CTAS already inserted the data, no need for separate INSERT
            }
        }
        
        // Regular INSERT for subsequent runs or S3 tables
        const query = instance.generateInsertQuery(context, sourceTableName);
        console.log(`Inserting into ${instance.tableName} with SQL:`, query);
        await instance.athenaUtils.executeQuery(query);
    }

    /**
     * Generate the static insert query (for backward compatibility)
     */
    static generateInsertQuery(context: TableContext, sourceTableName: string, config: Config): string {
        const instance = new (this as any)(config);
        return instance.generateInsertQuery(context, sourceTableName);
    }
}
