import { BaseTable } from "./base-table";
import { TableContext } from "../shared/types";

export class PackageEntryTable extends BaseTable {
    protected get tableName(): string {
        return "package_entry";
    }

    protected getCreateTableSchema(databaseName: string): string {
        return `
            CREATE TABLE "${databaseName}"."${this.tableName}" (
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

    protected generateSelectClause(registryName: string, sourceAlias: string): string {
        return `'${registryName}' AS registry,
              ${sourceAlias}.top_hash,
              ${sourceAlias}.logical_key,
              ${sourceAlias}.physical_key,
              concat(
                CASE ${sourceAlias}.hash.type
                  WHEN 'SHA256' THEN '1220'
                  WHEN 'sha2-256-chunked' THEN 'b150'
                  ELSE '0000'
                END,
                ${sourceAlias}.hash.value
              ) AS multihash,
              ${sourceAlias}.size,
              ${sourceAlias}.meta AS metadata`;
    }

    protected generateWhereClauseForCtas(sourceAlias: string): string {
        // No additional WHERE clause needed for CTAS in package entries
        return '';
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        const selectClause = this.generateSelectClause(context.registryName, 's');
        
        return `
            INSERT INTO "${context.targetDatabaseName}"."${this.tableName}" (registry, top_hash, logical_key, physical_key, multihash, size, metadata)
            SELECT DISTINCT
              ${selectClause}
            FROM "${context.sourceDatabaseName}"."${sourceTableName}" s
            LEFT JOIN "${context.targetDatabaseName}"."${this.tableName}" t
              ON s.logical_key = t.logical_key
              AND s.meta = t.metadata
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.logical_key IS NULL`;
    }
}
