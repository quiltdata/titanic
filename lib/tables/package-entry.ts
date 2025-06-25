import { tableExists, executeQuery } from "../shared/athena-utils";
import { TableContext } from "../shared/types";

export class PackageEntryTable {
    private static readonly TABLE_NAME = "package_entry";

    static async ensureExists(
        databaseName: string,
        targetBucket: string,
        sourceView: string
    ): Promise<void> {
        if (await tableExists(databaseName, this.TABLE_NAME)) {
            return;
        }

        console.log(`Creating ${this.TABLE_NAME} table using separate CREATE and INSERT`);
        await this.createTable(databaseName, targetBucket);
    }

    private static async createTable(
        databaseName: string,
        targetBucket: string
    ): Promise<void> {
        const createQuery = `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${this.TABLE_NAME}" (
              registry     STRING,    
              top_hash     STRING,
              logical_key  STRING,    
              physical_key STRING,    
              multihash   STRING,    
              size         BIGINT,    
              metadata    STRING        
            )
            PARTITIONED BY (
              registry,
              bucket(64, physical_key)
            )
        `;

        await executeQuery(createQuery, targetBucket);
    }

    static generateInsertQuery(context: TableContext, sourceTableName: string): string {
        return `
            INSERT INTO "${context.databaseName}"."${this.TABLE_NAME}" (registry, top_hash, logical_key, physical_key, multihash, size, metadata)
            SELECT DISTINCT
              '${context.registryName}' AS registry,
              s.top_hash,
              s.logical_key,
              s.physical_key,
              concat(
                CASE s.hash.type
                  WHEN 'SHA256' THEN '1220'
                  WHEN 'sha2-256-chunked' THEN 'b150'
                  ELSE '0000'
                END,
                s.hash.value
              ) AS multihash,
              s.size,
              s.meta AS metadata
            FROM "${context.databaseName}"."${sourceTableName}" s
            LEFT JOIN "${context.databaseName}"."${this.TABLE_NAME}" t
              ON s.logical_key = t.logical_key
              AND s.meta = t.metadata
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.logical_key IS NULL`;
    }

    static async insert(context: TableContext, sourceTableName: string): Promise<void> {
        const query = this.generateInsertQuery(context, sourceTableName);
        await executeQuery(query, context.targetBucket);
    }
}
