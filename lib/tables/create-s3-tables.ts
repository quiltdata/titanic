#!/usr/bin/env node
import "dotenv/config";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { S3Config } from "../shared/config";
import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";

/**
 * Utility class for creating S3 Tables namespace and tables using AWS CLI
 * This handles the manual setup required for S3 Tables as documented in the README
 */
export class S3TablesCreator {
    private config: S3Config;
    private tempDir: string;

    constructor(config?: S3Config) {
        this.config = config || new S3Config();
        this.tempDir = join(process.cwd(), 'temp-s3-tables');
    }

    /**
     * Create namespace using AWS CLI
     */
    async createNamespace(): Promise<void> {
        const bucketArn = this.config.generateS3TablesBucketArn();
        const namespace = this.config.namespace; // Just the namespace part, not the full s3tablesbucket.namespace

        console.log(`📋 Creating namespace '${namespace}' in S3 Tables bucket: ${bucketArn}`);

        try {
            const command = `aws s3tables create-namespace --table-bucket-arn "${bucketArn}" --namespace "${namespace}"`;
            console.log(`🔧 Running: ${command}`);
            
            const result = execSync(command, { 
                encoding: 'utf8',
                stdio: ['inherit', 'pipe', 'pipe']
            });
            
            console.log(`✅ Namespace created successfully: ${namespace}`);
            console.log(`📄 Response: ${result}`);
        } catch (error: any) {
            // Check if namespace already exists
            if (error.message.includes('ConflictException') || error.message.includes('already exists')) {
                console.log(`✅ Namespace already exists: ${namespace}`);
            } else {
                console.error(`❌ Failed to create namespace: ${error.message}`);
                throw error;
            }
        }
    }

    /**
     * Create all required tables using AWS CLI
     */
    async createTables(): Promise<void> {
        // Ensure namespace exists first
        await this.createNamespace();

        // Create temp directory for table definitions
        mkdirSync(this.tempDir, { recursive: true });

        try {
            const tables = [
                new PackageRevisionTable(this.config),
                new PackageTagTable(this.config),
                new PackageEntryTable(this.config)
            ];

            for (const table of tables) {
                await this.createTable(table);
            }
        } finally {
            // Clean up temp directory
            try {
                execSync(`rm -rf "${this.tempDir}"`, { stdio: 'ignore' });
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Create a single table using AWS CLI
     */
    private async createTable(table: any): Promise<void> {
        const bucketArn = this.config.generateS3TablesBucketArn();
        const namespace = this.config.namespace;
        const tableName = table.tableName;

        console.log(`📋 Creating table '${tableName}' in namespace '${namespace}'`);

        // Generate table definition JSON
        const tableDefinition = this.generateTableDefinition(table, bucketArn, namespace);
        const tempFile = join(this.tempDir, `${tableName}-definition.json`);
        
        writeFileSync(tempFile, JSON.stringify(tableDefinition, null, 2));
        console.log(`📄 Generated table definition: ${tempFile}`);

        try {
            const command = `aws s3tables create-table --cli-input-json file://"${tempFile}"`;
            console.log(`🔧 Running: ${command}`);
            
            const result = execSync(command, { 
                encoding: 'utf8',
                stdio: ['inherit', 'pipe', 'pipe']
            });
            
            console.log(`✅ Table created successfully: ${tableName}`);
            console.log(`📄 Response: ${result}`);
        } catch (error: any) {
            // Check if table already exists
            if (error.message.includes('ConflictException') || error.message.includes('already exists')) {
                console.log(`✅ Table already exists: ${tableName}`);
            } else {
                console.error(`❌ Failed to create table ${tableName}: ${error.message}`);
                throw error;
            }
        }
    }

    /**
     * Generate AWS CLI table definition JSON for a given table
     */
    private generateTableDefinition(table: any, bucketArn: string, namespace: string): any {
        const columnDefinitions = table['getColumnDefinitions']();
        const partitioningClause = table.getPartitioningClause();
        
        // Convert column definitions to S3 Tables format
        const fields = Object.entries(columnDefinitions).map(([name, type]) => {
            return {
                name: name,
                type: this.convertTypeToS3Tables(type as string),
                required: name === 'registry' || name === 'pkg_name' || name === 'top_hash' // Mark key fields as required
            };
        });

        // Parse partitioning information
        const partitionFields = this.parsePartitioning(partitioningClause);

        return {
            tableBucketARN: bucketArn,
            namespace: namespace,
            name: table.tableName,
            format: "ICEBERG",
            metadata: {
                iceberg: {
                    schema: {
                        fields: fields
                    },
                    partitionSpec: partitionFields.length > 0 ? partitionFields : undefined
                }
            }
        };
    }

    /**
     * Convert SQL types to S3 Tables schema types
     */
    private convertTypeToS3Tables(sqlType: string): string {
        const typeMap: { [key: string]: string } = {
            'STRING': 'string',
            'BIGINT': 'long',
            'TIMESTAMP': 'timestamp',
            'INT': 'int',
            'DOUBLE': 'double',
            'BOOLEAN': 'boolean'
        };

        return typeMap[sqlType.toUpperCase()] || 'string';
    }

    /**
     * Parse partitioning clause to extract partition fields
     * Example: "PARTITIONED BY (registry, bucket(8, pkg_name), bucket(8, top_hash))"
     */
    private parsePartitioning(partitioningClause: string): any[] {
        if (!partitioningClause) return [];

        // Extract content between parentheses, handling nested parentheses
        const match = partitioningClause.match(/PARTITIONED BY \((.+)\)$/i);
        if (!match) return [];

        // Split by commas, but be careful of commas inside bucket() functions
        const partitionSpecs: string[] = [];
        let current = '';
        let parenDepth = 0;
        
        for (const char of match[1]) {
            if (char === '(') {
                parenDepth++;
                current += char;
            } else if (char === ')') {
                parenDepth--;
                current += char;
            } else if (char === ',' && parenDepth === 0) {
                partitionSpecs.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        if (current.trim()) {
            partitionSpecs.push(current.trim());
        }

        const partitionFields: any[] = [];

        partitionSpecs.forEach((spec, index) => {
            if (spec.includes('bucket(')) {
                // Handle bucket partitioning: bucket(8, pkg_name)
                const bucketMatch = spec.match(/bucket\((\d+),\s*([^)]+)\)/);
                if (bucketMatch) {
                    partitionFields.push({
                        sourceColumnId: bucketMatch[2].trim(),
                        fieldId: index + 1,
                        transform: "bucket",
                        transformArgs: [parseInt(bucketMatch[1])]
                    });
                }
            } else {
                // Handle identity partitioning
                partitionFields.push({
                    sourceColumnId: spec,
                    fieldId: index + 1,
                    transform: "identity"
                });
            }
        });

        return partitionFields;
    }

    /**
     * Check if the required AWS CLI tools are available
     */
    static checkPrerequisites(): void {
        try {
            execSync('aws --version', { stdio: 'ignore' });
        } catch (error) {
            throw new Error("AWS CLI is not installed or not in PATH. Please install AWS CLI to use S3 Tables functionality.");
        }

        try {
            execSync('aws s3tables help', { stdio: 'ignore' });
        } catch (error) {
            throw new Error("AWS CLI s3tables commands are not available. Please update AWS CLI to a version that supports S3 Tables.");
        }
    }
}

/**
 * CLI entry point for standalone execution
 */
async function main() {
    console.log("🚀 S3 Tables Creator");
    
    // Check command line arguments
    const args = process.argv.slice(2);
    const command = args[0] || 'all';

    try {
        // Check prerequisites
        S3TablesCreator.checkPrerequisites();

        // Create S3Config (ensures S3 Tables mode)
        const config = new S3Config();
        
        const creator = new S3TablesCreator(config);

        switch (command) {
            case 'namespace':
                await creator.createNamespace();
                break;
            case 'tables':
                await creator.createTables();
                break;
            case 'all':
            default:
                await creator.createNamespace();
                await creator.createTables();
                break;
        }

        console.log("✅ S3 Tables creation completed successfully!");
    } catch (error) {
        console.error("❌ S3 Tables creation failed:", error);
        process.exit(1);
    }
}

// Run main function if this file is executed directly
if (require.main === module) {
    main();
}
