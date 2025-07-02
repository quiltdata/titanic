import { Table } from "@aws-sdk/client-glue";
import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { BaseTable } from "./base-table";
import { TableContext, createTableContext } from "../shared/types";
import { AthenaUtils } from "../shared/athena-utils";
import { Config } from "../shared/config";

export class TableManager {
    private athenaUtils: AthenaUtils;

    constructor(
        private config: Config, // Pass config as parameter
        private glueDatabaseName: string,
        private targetDatabaseName: string,
        private targetBucket: string
    ) {
        this.athenaUtils = new AthenaUtils(config);
    }

    /**
     * Drop tables if they exist - separate from table creation logic
     * This should only be called when explicitly needed (e.g., during deployments)
     * and is completely independent of the ensureTablesExist() method.
     */
    async dropTablesIfExist(): Promise<void> {
        console.log(`🗑️ Dropping Titanic tables if they exist in target database: ${this.targetDatabaseName}`);
        await this.athenaUtils.dropAllTitanicTables(this.targetDatabaseName);
    }

    /**
     * Ensure tables exist based on source tables found
     * This method always runs when needed, regardless of whether tables were dropped or not.
     * It creates empty tables for S3 Tables mode, or prepares for lazy creation in Glue mode.
     */

    async ensureTablesExist(sourceTables: Table[]): Promise<{ successfulTables: number; failedTables: number; totalTables: number }> {
        console.log(`📋 Ensuring tables exist in target database: ${this.targetDatabaseName}`);
        console.log(`📋 Config type: ${this.config.constructor.name}, Target bucket: ${this.targetBucket}`);
        
        // Find representative views for each table type
        const packagesView = sourceTables.find(t => t.Name?.includes('packages-view'))?.Name;
        const entriesView = sourceTables.find(t => t.Name?.includes('objects-view'))?.Name;

        console.log(`📋 Found source views:`, {
            packagesView: packagesView || 'NOT FOUND',
            entriesView: entriesView || 'NOT FOUND'
        });

        let successfulTables = 0;
        let failedTables = 0;
        let totalTables = 0;

        // Create tables if needed
        if (packagesView) {
            totalTables += 2; // package_revision and package_tag
            console.log(`📋 Processing package tables from view: ${packagesView}`);
            
            // Check if package_revision exists
            try {
                const revisionExists = await this.athenaUtils.tableExists('package_revision', this.targetDatabaseName);
                console.log(`📋 package_revision table ${revisionExists ? 'EXISTS' : 'NEEDS TO BE CREATED'}`);
                
                await PackageRevisionTable.ensureExists(this.config, packagesView);
                successfulTables++;
                console.log(`✅ package_revision table ensured (${revisionExists ? 'existed' : 'created'})`);
            } catch (error) {
                const err = error as Error;
                failedTables++;
                console.error(`❌ Failed to ensure package_revision table exists for view ${packagesView}:`, {
                    error: err.message,
                    stack: err.stack,
                });
            }

            try {
                const tagExists = await this.athenaUtils.tableExists('package_tag', this.targetDatabaseName);
                console.log(`📋 package_tag table ${tagExists ? 'EXISTS' : 'NEEDS TO BE CREATED'}`);
                
                await PackageTagTable.ensureExists(this.config, packagesView);
                successfulTables++;
                console.log(`✅ package_tag table ensured (${tagExists ? 'existed' : 'created'})`);
            } catch (error) {
                const err = error as Error;
                failedTables++;
                console.error(`❌ Failed to ensure package_tag table exists for view ${packagesView}:`, {
                    error: err.message,
                    stack: err.stack,
                });
            }
        }

        if (entriesView) {
            totalTables += 1; // package_entry
            console.log(`📋 Processing entry table from view: ${entriesView}`);
            
            try {
                const entryExists = await this.athenaUtils.tableExists('package_entry', this.targetDatabaseName);
                console.log(`📋 package_entry table ${entryExists ? 'EXISTS' : 'NEEDS TO BE CREATED'}`);
                
                await PackageEntryTable.ensureExists(this.config, entriesView);
                successfulTables++;
                console.log(`✅ package_entry table ensured (${entryExists ? 'existed' : 'created'})`);
            } catch (error) {
                const err = error as Error;
                failedTables++;
                console.error(`❌ Failed to ensure package_entry table exists for view ${entriesView}:`, {
                    error: err.message,
                    stack: err.stack,
                });
            }
        }

        console.log(`📋 Table existence summary: ${successfulTables} successful, ${failedTables} failed out of ${totalTables} total`);
        return { successfulTables, failedTables, totalTables };
    }

    async executeInserts(sourceTables: Table[]): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        let queryCount = 0;
        let successfulTables = 0;
        let failedTables = 0;

        for (const table of sourceTables) {
            if (!table.Name) continue;

            let tableSuccessful = true;
            let tableQueryCount = 0;
            const registryName = Config.sourceBucketFromTableName(table.Name);

            try {
                const context = createTableContext(registryName);

                const isPackagesView = table.Name.includes('packages-view');

                if (isPackagesView) {
                    // Handle package revisions and tags
                    try {
                        await PackageRevisionTable.insert(context, table.Name, this.config);
                        tableQueryCount++;
                        console.log(`✅ Successfully inserted package revisions from ${table.Name}`);
                    } catch (error) {
                        const err = error as Error;
                        tableQueryCount++; // Count the attempted operation
                        tableSuccessful = false;
                        console.error(`❌ Failed to insert package revisions from ${table.Name}:`, {
                            error: err.message,
                            registryName,
                            isS3AccessError: this.isS3AccessError(err),
                        });
                    }

                    try {
                        await PackageTagTable.insert(context, table.Name, this.config);
                        tableQueryCount++;
                        console.log(`✅ Successfully inserted package tags from ${table.Name}`);
                    } catch (error) {
                        const err = error as Error;
                        tableQueryCount++; // Count the attempted operation
                        tableSuccessful = false;
                        console.error(`❌ Failed to insert package tags from ${table.Name}:`, {
                            error: err.message,
                            registryName,
                            isS3AccessError: this.isS3AccessError(err),
                        });
                    }
                } else if (table.Name.includes('objects-view')) {
                    // Handle package entries
                    try {
                        await PackageEntryTable.insert(context, table.Name, this.config);
                        tableQueryCount++;
                        console.log(`✅ Successfully inserted package entries from ${table.Name}`);
                    } catch (error) {
                        const err = error as Error;
                        tableQueryCount++; // Count the attempted operation
                        tableSuccessful = false;
                        console.error(`❌ Failed to insert package entries from ${table.Name}:`, {
                            error: err.message,
                            registryName,
                            isS3AccessError: this.isS3AccessError(err),
                        });
                    }
                }

                // Only count as successful if ALL operations for this table succeeded
                if (tableSuccessful && tableQueryCount > 0) {
                    successfulTables++;
                    console.log(`✅ All operations successful for table ${table.Name}`);
                } else if (tableQueryCount === 0) {
                    console.log(`⚠️ No operations executed for table ${table.Name} (may not match expected patterns)`);
                } else {
                    failedTables++;
                    console.log(`❌ Some operations failed for table ${table.Name}`);
                }

                queryCount += tableQueryCount;

            } catch (error) {
                const err = error as Error;
                console.error(`❌ Failed to process table ${table.Name}:`, {
                    error: err.message,
                    registryName,
                    isS3AccessError: this.isS3AccessError(err),
                    stack: err.stack,
                });
                failedTables++;
                // Continue processing other tables
            }
        }

        console.log(`Table processing summary:`, {
            totalTables: sourceTables.length,
            successfulTables,
            failedTables,
            totalQueries: queryCount,
        });

        return { successfulTables, failedTables, totalQueries: queryCount };
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
