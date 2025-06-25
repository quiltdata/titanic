import { BaseTable } from "./base-table";
import { TableContext } from "../shared/types";

export class PackageEntryTable extends BaseTable {
    protected get tableName(): string {
        return "package_entry";
    }

    protected getCreateTableSchema(databaseName: string): string {
        return `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${this.tableName}" (
              registry     STRING,    
              top_hash     STRING,
              logical_key  STRING,    
              physical_key STRING,    
              multihash   STRING,    
              size         BIGINT,    
              metadata    STRING        
            )
        `;
    }

    protected getPartitioningClause(): string {
        return `PARTITIONED BY (
              registry,
              bucket(64, physical_key)
            )`;
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        return `
            INSERT INTO "${context.databaseName}"."${this.tableName}" (registry, top_hash, logical_key, physical_key, multihash, size, metadata)
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
            LEFT JOIN "${context.databaseName}"."${this.tableName}" t
              ON s.logical_key = t.logical_key
              AND s.meta = t.metadata
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.logical_key IS NULL`;
    }
}
