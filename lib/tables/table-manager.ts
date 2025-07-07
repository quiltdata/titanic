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
        private glueDatabaseName: string,
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
        glueDatabaseName: string,
        targetDatabaseName: string,
        targetBucket: string,
        athenaUtils: AthenaUtils
    ): TableManager {
        return new TableManager(config, glueDatabaseName, targetDatabaseName, targetBucket, athenaUtils);
    }

    /**
     * Explicitly create tables based on source tables found
     * This method creates empty tables for S3 Tables mode, or prepares for lazy creation in Glue mode.
     */
    async createTables(): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        console.log(`📋 Creating tables in target database: ${this.targetDatabaseName}`);
        console.log(`📋 Config type: ${this.config.constructor.name}, Target bucket: ${this.targetBucket}`);

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
                    successfulTables++;
                    successfulTableNames.push(table.tableName);
                } else {
                    failedTables++;
                    failedTableNames.push(table.tableName);
                    console.error(`Query execution failed for ${type} on ${table.tableName}:`, result.error);
                }
            } catch (error) {
                const err = error as Error;
                totalQueries++;
                failedTables++;
                failedTableNames.push(table.tableName);
                console.error(`Failed to execute ${type} on ${table.tableName}:`, {
                    error: err.message,
                    isS3AccessError: this.isS3AccessError(err),
                });
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
     * Ensure all managed tables exist: check existence, log, and create if necessary
     * Returns { successfulTables, failedTables, totalQueries }
     */
    public async ensureExists(): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        let successfulTables = 0;
        let failedTables = 0;
        let totalQueries = 0;
        for (const table of this.targetTables) {
            try {
                const exists = await table.tableExists(this.athenaUtils);
                totalQueries++;
                if (exists) {
                    console.log(`✅ Table exists: ${table.tableName}`);
                    successfulTables++;
                } else {
                    console.log(`⚠️  Table does not exist, creating: ${table.tableName}`);
                    const createResult = await this.athenaUtils.executeQuery(table.query('create'));
                    totalQueries++;
                    if (createResult.success) {
                        console.log(`✅ Table created: ${table.tableName}`);
                        successfulTables++;
                    } else {
                        console.error(`❌ Failed to create table: ${table.tableName}`, createResult.error);
                        failedTables++;
                    }
                }
            } catch (err) {
                console.error(`❌ Error ensuring table ${table.tableName}:`, err);
                failedTables++;
                totalQueries++;
            }
        }
        return { successfulTables, failedTables, totalQueries };
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
