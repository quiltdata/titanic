import { executeQuery, tableExists } from "../shared/athena-utils";

/**
 * Configuration interface that table classes must implement
 */
export interface TableConfig {
    TABLE_NAME: string;
    getPartitionClause(): string;
    getTableSchema(): string;
}

/**
 * Base utility functions for Iceberg table operations
 * Provides common functionality for table creation and management
 */
export class BaseTableOperations {
    protected static readonly TABLE_FORMAT = 'PARQUET';
    protected static readonly COMPRESSION = 'SNAPPY';
    protected static readonly TABLE_TYPE = 'ICEBERG';
    
    /**
     * Common method to ensure table exists, using CTAS if needed
     */
    static async ensureExists(
        config: TableConfig,
        databaseName: string,
        targetBucket: string,
        sourceView: string
    ): Promise<void> {
        if (await tableExists(databaseName, config.TABLE_NAME)) {
            return;
        }

        console.log(`Creating ${config.TABLE_NAME} table using CTAS from ${sourceView}`);
        await this.createTableWithCTAS(config, databaseName, sourceView, targetBucket);
    }

    /**
     * Common CTAS table creation method
     */
    private static async createTableWithCTAS(
        config: TableConfig,
        databaseName: string,
        sourceView: string,
        targetBucket: string
    ): Promise<void> {
        const schema = this.buildCreateTableSchema(config, targetBucket);
        const query = `
            CREATE TABLE "${databaseName}"."${config.TABLE_NAME}"
            ${schema}
            AS ${config.getTableSchema()}
            FROM "${databaseName}"."${sourceView}"
            LIMIT 0`;

        await executeQuery(query, targetBucket);
    }

    /**
     * Build the WITH clause for table creation
     */
    private static buildCreateTableSchema(config: TableConfig, targetBucket: string): string {
        return `
            WITH (
                format = '${this.TABLE_FORMAT}',
                write_compression = '${this.COMPRESSION}',
                location = 's3://${targetBucket}/${config.TABLE_NAME}/',
                table_type = '${this.TABLE_TYPE}',
                is_external = false
            )
            ${config.getPartitionClause()}`;
    }

    /**
     * Validate that required environment variables are present
     */
    protected static validateEnvironment(): { databaseName: string; targetBucket: string } {
        const databaseName = process.env.DATABASE_NAME;
        const targetBucket = process.env.TARGET_BUCKET;

        if (!databaseName || !targetBucket) {
            throw new Error("Missing required environment variables: DATABASE_NAME or TARGET_BUCKET");
        }

        return { databaseName, targetBucket };
    }
}
