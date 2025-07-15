import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { BaseTable } from "./base-table";
import { AthenaUtils } from "../shared/athena-utils";
import { Config } from "../shared/config";

export class TableManager {
    private athenaUtils: AthenaUtils;
    private targetTables: BaseTable[];

    constructor(
        private config: Config, // Pass config as parameter
        private athenaDatabaseName: string,
        private targetDatabaseName: string,
        private targetBucket: string,
        athenaUtils?: AthenaUtils // Optional for testing
    ) {
        this.athenaUtils = athenaUtils || new AthenaUtils(config);
        
        // Create table instances
        this.targetTables = [
            new PackageRevisionTable(config),
            new PackageTagTable(config),
            new PackageEntryTable(config)
        ];
    }

    /**
     * Create a test instance with injectable AthenaUtils for mocking
     */
    static createTestInstance(
        config: Config,
        athenaDatabaseName: string,
        targetDatabaseName: string,
        targetBucket: string,
        athenaUtils: AthenaUtils
    ): TableManager {
        return new TableManager(config, athenaDatabaseName, targetDatabaseName, targetBucket, athenaUtils);
    }

    /**
     * Create the target database if it doesn't exist (needed for S3 Tables mode)
     */
    async createDatabaseIfNeeded(): Promise<void> {
        // Only needed for S3 Tables mode where target database is different from source
        if (this.config.useS3Table && this.targetDatabaseName !== this.athenaDatabaseName) {
            console.log(`📋 Ensuring target database exists: ${this.targetDatabaseName}`);
            
            const createDatabaseQuery = `CREATE DATABASE IF NOT EXISTS ${this.targetDatabaseName}`;
            const result = await this.athenaUtils.executeQuery(createDatabaseQuery);
            
            if (result.success) {
                console.log(`✅ Database ready: ${this.targetDatabaseName}`);
            } else {
                console.warn(`⚠️ Database creation warning for ${this.targetDatabaseName}:`, result.error);
                // Don't fail here - database might already exist and that's fine
            }
        }
    }

    /**
     * Explicitly create tables based on source tables found
     * This method creates empty tables for S3 Tables mode, or prepares for lazy creation in Glue mode.
     */
    async createTables(): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        console.log(`📋 Creating tables in target database: ${this.targetDatabaseName}`);
        console.log(`📋 Config type: ${this.config.constructor.name}, Target bucket: ${this.targetBucket}`);

        // Ensure target database exists (needed for S3 Tables mode)
        await this.createDatabaseIfNeeded();

        const result = await this.execute('create');
        
        console.log(`📋 Table creation summary: ${result.successfulTables} successful, ${result.failedTables} failed out of ${result.totalQueries} total`);
        return result;
    }

    async executeInserts(packageView: string, objectsView: string): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        return await this.execute('insert', packageView, objectsView);
    }

    async executeDrops(): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        return await this.execute('drop');
    }

    /**
     * Execute a query type on all target tables
     * Handles all errors gracefully, including "table already exists" for create operations
     */
    async execute(type: 'create' | 'insert' | 'drop', packagesView?: string, objectsView?: string): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        let totalQueries = 0;
        let successfulTables = 0;
        let failedTables = 0;
        const successfulTableNames: string[] = [];
        const failedTableNames: string[] = [];

        for (const table of this.targetTables) {
            try {
                const query = table.query(type, packagesView, objectsView);
                const result = await this.athenaUtils.executeQuery(query);
                totalQueries++;
                
                if (result.success) {
                    console.log(`✅ ${type} successful: ${table.tableName}`);
                    successfulTables++;
                    successfulTableNames.push(table.tableName);
                } else if (type === 'create' && this.isTableAlreadyExistsError(result.error)) {
                    console.log(`✅ Table already exists: ${table.tableName}`);
                    successfulTables++;
                    successfulTableNames.push(table.tableName);
                } else {
                    console.error(`❌ ${type} failed for ${table.tableName}:`, result.error);
                    failedTables++;
                    failedTableNames.push(table.tableName);
                }
            } catch (error) {
                const err = error as Error;
                totalQueries++;
                
                if (type === 'create' && this.isTableAlreadyExistsError(err.message)) {
                    console.log(`✅ Table already exists: ${table.tableName}`);
                    successfulTables++;
                    successfulTableNames.push(table.tableName);
                } else {
                    console.error(`❌ Failed to execute ${type} on ${table.tableName}:`, {
                        error: err.message,
                        isS3AccessError: this.isS3AccessError(err),
                    });
                    failedTables++;
                    failedTableNames.push(table.tableName);
                }
            }
        }

        console.log(`${type} operation summary:`, {
            successfulTables,
            failedTables,
            totalQueries,
            successfulTableNames,
            failedTableNames
        });

        return { successfulTables, failedTables, totalQueries };
    }



    /**
     * Check if an error indicates the table already exists
     */
    private isTableAlreadyExistsError(errorMessage?: string): boolean {
        if (!errorMessage) return false;
        const lowerMessage = errorMessage.toLowerCase();
        return lowerMessage.includes('table already exists') ||
               lowerMessage.includes('already exists') ||
               lowerMessage.includes('duplicate table') ||
               lowerMessage.includes('table_already_exists');
    }

    /**
     * Check if an error is related to S3 access issues
     */
    private isS3AccessError(error: Error): boolean {
        const errorMessage = error.message.toLowerCase();
        return errorMessage.includes('access denied') ||
               errorMessage.includes('accessdenied') ||
               errorMessage.includes('no such bucket') ||
               errorMessage.includes('forbidden') ||
               errorMessage.includes('403') ||
               errorMessage.includes('bucket does not exist');
    }
}
